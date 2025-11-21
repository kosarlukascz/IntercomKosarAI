import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL;
const INTERCOM_ACCESS_TOKEN = process.env.INTERCOM_ACCESS_TOKEN;
const INTERCOM_CLIENT_SECRET = process.env.INTERCOM_CLIENT_SECRET;
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL;

app.use(express.json());

// In-memory cache for AI recommendations
const aiCache = new Map();

// Background processing function for n8n webhook
async function processN8nWebhook(webhookPayload, conversationId, customerEmail, messageCount) {
    try {
        console.log(`Background: Processing n8n webhook for conversation ${conversationId}...`);

        // Parse n8n webhook URL to extract credentials
        const n8nUrl = new URL(N8N_WEBHOOK_URL);
        const n8nUsername = n8nUrl.username || '';
        const n8nPassword = n8nUrl.password || '';

        // Remove credentials from URL
        const cleanN8nUrl = `${n8nUrl.protocol}//${n8nUrl.host}${n8nUrl.pathname}${n8nUrl.search}`;

        // Prepare headers with Basic Auth if credentials exist
        const n8nHeaders = {
            'Content-Type': 'application/json'
        };

        if (n8nUsername && n8nPassword) {
            const basicAuth = Buffer.from(`${n8nUsername}:${n8nPassword}`).toString('base64');
            n8nHeaders['Authorization'] = `Basic ${basicAuth}`;
        }

        console.log(`Background: Calling n8n webhook at ${cleanN8nUrl}...`);
        const n8nResponse = await fetch(cleanN8nUrl, {
            method: 'POST',
            headers: n8nHeaders,
            body: JSON.stringify(webhookPayload)
        });

        console.log(`Background: n8n webhook responded with status ${n8nResponse.status}`);
        console.log(`Background: Response headers:`, n8nResponse.headers.raw());

        if (!n8nResponse.ok) {
            const errorText = await n8nResponse.text();
            throw new Error(`n8n webhook error: ${n8nResponse.status} - ${errorText}`);
        }

        // Get the response text first to debug issues
        const responseText = await n8nResponse.text();
        console.log(`Background: Response text length: ${responseText.length} chars`);
        console.log(`Background: n8n response text (first 500 chars): ${responseText.substring(0, 500)}`);

        // Check if response is empty
        if (!responseText || responseText.trim() === '') {
            throw new Error('n8n webhook returned empty response');
        }

        // Try to parse JSON
        let aiRecommendations;
        try {
            aiRecommendations = JSON.parse(responseText);
        } catch (parseError) {
            throw new Error(`n8n webhook returned invalid JSON: ${parseError.message}. Response: ${responseText.substring(0, 200)}`);
        }
        console.log(`Background: Received AI recommendations for conversation ${conversationId}`);

        // Transform n8n response to expected format
        // n8n returns array with content blocks, we need to extract text and format as recommended_replies
        if (Array.isArray(aiRecommendations)) {
            console.log(`Background: Transforming Claude API response format...`);
            // Extract text from content blocks
            const replies = [];
            aiRecommendations.forEach((item, index) => {
                if (item.content && Array.isArray(item.content)) {
                    item.content.forEach(contentBlock => {
                        if (contentBlock.type === 'text' && contentBlock.text) {
                            replies.push({
                                id: `reply-${index}`,
                                text: contentBlock.text,
                                confidence: 0.95,
                                tone: 'professional'
                            });
                        }
                    });
                }
            });

            // Format as expected structure
            if (replies.length > 0) {
                aiRecommendations = {
                    recommended_replies: replies,
                    context_analysis: {
                        sentiment: 'positive',
                        urgency: 'medium',
                        category: 'support'
                    }
                };
                console.log(`Background: Transformed ${replies.length} replies`);
            } else {
                console.log(`Background: No text content found in response`);
            }
        }

        // Store in cache with 5 minute expiry
        aiCache.set(conversationId, {
            data: aiRecommendations,
            customerEmail,
            messageCount,
            timestamp: Date.now(),
            expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
        });

        console.log(`Background: Cached recommendations for conversation ${conversationId}`);
    } catch (error) {
        console.error(`Background: Error processing conversation ${conversationId}:`, error);
        // Store error in cache
        aiCache.set(conversationId, {
            error: error.message,
            timestamp: Date.now(),
            expiresAt: Date.now() + (5 * 60 * 1000)
        });
    }
}

// Helper function to safely extract email from various possible locations in the request body
function extractEmail(body) {
    return body?.contact?.email ||
           body?.context?.contact?.email ||
           body?.context?.customer?.email ||
           body?.context?.user?.email ||
           body?.customer?.email ||
           body?.user?.email ||
           body?.input_values?.email ||
           null;
}

// Helper function to strip HTML tags from text
function stripHtml(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>/g, '').trim();
}

// Helper function to extract messages from conversation
function extractMessages(conversation) {
    const messages = [];

    // Add initial message
    if (conversation.source) {
        messages.push({
            id: conversation.source.id,
            type: 'initial_message',
            author_type: conversation.source.author.type,
            author_email: conversation.source.author.email,
            author_name: conversation.source.author.name,
            text: stripHtml(conversation.source.body),
            timestamp: conversation.created_at
        });
    }

    // Add conversation parts
    if (conversation.conversation_parts?.conversation_parts) {
        conversation.conversation_parts.conversation_parts.forEach(part => {
            messages.push({
                id: part.id,
                type: part.part_type,
                author_type: part.author.type,
                author_email: part.author.email,
                author_name: part.author.name,
                text: stripHtml(part.body),
                timestamp: part.created_at
            });
        });
    }

    return messages;
}

// Helper function to verify Intercom signature
function verifySignature(body, signature, secret) {
    if (!signature || !secret) return false;

    const hash = crypto
        .createHmac('sha256', secret)
        .update(JSON.stringify(body))
        .digest('hex');

    try {
        return crypto.timingSafeEqual(
            Buffer.from(hash),
            Buffer.from(signature)
        );
    } catch (error) {
        return false;
    }
}

// Helper function to format date in DD/MM/YYYY format
function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString('en-GB');
}

// Helper function to translate status codes to readable text
function translateState(state) {
    const stateMap = {
        'LIVE': 'LIVE',
        'END_FAIL': 'FAILED',
        'ONGOING': 'ONGOING',
        'END_SUCCESS': 'PASSED'
    };
    return stateMap[state] || state;
}

// Main endpoint for Intercom Canvas initialization
app.post('/initialize', async (req, res) => {
    console.log('Received request:', JSON.stringify(req.body, null, 2));

    // Verify signature (optional but recommended)
    const signature = req.headers['x-body-signature'];
    if (INTERCOM_CLIENT_SECRET && signature) {
        const isValid = verifySignature(req.body, signature, INTERCOM_CLIENT_SECRET);
        if (!isValid) {
            console.warn('Invalid signature detected');
            return res.status(401).json({ error: 'Invalid signature' });
        }
    }

    // Extract conversation ID and email
    const conversationId = req.body.context?.conversation_id || req.body.conversation?.id;
    const customerEmail = extractEmail(req.body);
    const agentEmail = req.body.admin?.email;
    const workspaceId = req.body.workspace_id;

    console.log(`Conversation ID: ${conversationId}`);
    console.log(`Customer email: ${customerEmail}`);

    // Check if we're in a conversation context
    if (!conversationId) {
        return res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: "ℹ️ **Not in Conversation**\n\nPlease open this app from within a conversation to see AI-recommended replies."
                        }
                    ]
                }
            }
        });
    }

    // Check configuration
    if (!INTERCOM_ACCESS_TOKEN) {
        return res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: "⚠️ **Configuration Error**\n\nINTERCOM_ACCESS_TOKEN is not configured. Please set it in environment variables."
                        }
                    ]
                }
            }
        });
    }

    if (!N8N_WEBHOOK_URL) {
        return res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: "⚠️ **Configuration Error**\n\nN8N_WEBHOOK_URL is not configured. Please set it in environment variables."
                        }
                    ]
                }
            }
        });
    }

    try {
        // 1. Fetch conversation from Intercom API
        console.log(`Fetching conversation ${conversationId} from Intercom...`);
        const conversationResponse = await fetch(
            `https://api.intercom.io/conversations/${conversationId}`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${INTERCOM_ACCESS_TOKEN}`,
                    'Intercom-Version': '2.14',
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!conversationResponse.ok) {
            throw new Error(`Intercom API error: ${conversationResponse.status} - ${await conversationResponse.text()}`);
        }

        const conversation = await conversationResponse.json();
        console.log(`Conversation fetched successfully. State: ${conversation.state}`);

        // 2. Extract messages
        const messages = extractMessages(conversation);
        console.log(`Extracted ${messages.length} messages`);

        // 3. Prepare payload for n8n webhook
        const webhookPayload = {
            conversation_id: conversationId,
            customer_email: customerEmail,
            agent_email: agentEmail,
            workspace_id: workspaceId,
            conversation: {
                state: conversation.state,
                created_at: conversation.created_at,
                updated_at: conversation.updated_at
            },
            messages: messages,
            metadata: {
                total_messages: messages.length,
                waiting_since: conversation.waiting_since
            }
        };

        // 4. Return immediate loading response, then process in background
        console.log('Returning loading state and processing in background...');

        // Send immediate loading response (under 10s timeout)
        res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: "# 🤖 AI Reply Assistant"
                        },
                        {
                            type: "text",
                            text: "⏳ **Generating AI recommendations...**\n\nAnalyzing conversation and preparing suggested replies. This may take a few moments."
                        },
                        {
                            type: "divider"
                        },
                        {
                            type: "text",
                            text: `📧 Customer: **${customerEmail}**\n📊 Messages: **${messages.length}**`
                        },
                        {
                            type: "spacer",
                            size: "s"
                        },
                        {
                            type: "button",
                            id: "refresh_now",
                            label: "🔄 Check Status",
                            style: "primary",
                            action: {
                                type: "submit"
                            }
                        }
                    ]
                }
            }
        });

        // Process n8n webhook in background (async, don't await)
        processN8nWebhook(webhookPayload, conversationId, customerEmail, messages.length).catch(err => {
            console.error('Background n8n processing error:', err);
        });

    } catch (error) {
        console.error('Error in initialize endpoint:', error);
        res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: `❌ **Error**\n\nFailed to generate AI recommendations: ${error.message}`
                        },
                        {
                            type: "divider"
                        },
                        {
                            type: "text",
                            text: "Please try again or contact support if the issue persists."
                        }
                    ]
                }
            }
        });
    }
});

// Build Canvas components with AI-recommended replies
function buildRecommendedRepliesCanvas(aiRecommendations, customerEmail, messageCount) {
    const components = [];

    // Header
    components.push({
        type: "text",
        text: "# 🤖 AI Recommended Replies"
    });

    components.push({
        type: "text",
        text: `Generated for **${customerEmail || 'customer'}** based on ${messageCount} message${messageCount !== 1 ? 's' : ''} in the conversation.`
    });

    components.push({
        type: "divider"
    });

    // Check if we have recommended replies
    if (aiRecommendations?.recommended_replies && Array.isArray(aiRecommendations.recommended_replies)) {
        aiRecommendations.recommended_replies.forEach((reply, index) => {
            // Reply header with confidence
            const confidence = reply.confidence ? Math.round(reply.confidence * 100) : 0;
            components.push({
                type: "text",
                text: `**Option ${index + 1}** ${confidence > 0 ? `(${confidence}% confidence)` : ''}`
            });

            // Reply text in textarea for editing
            components.push({
                type: "textarea",
                id: `reply_text_${reply.id || index}`,
                label: "Edit reply if needed:",
                value: reply.text || '',
                placeholder: "Edit this reply before using..."
            });

            // Use button
            components.push({
                type: "button",
                id: `use_reply_${reply.id || index}`,
                label: "📋 Copy This Reply",
                style: "primary",
                action: {
                    type: "submit"
                }
            });

            // Add spacer between replies
            if (index < aiRecommendations.recommended_replies.length - 1) {
                components.push({
                    type: "spacer",
                    size: "s"
                });
                components.push({
                    type: "divider"
                });
                components.push({
                    type: "spacer",
                    size: "s"
                });
            }
        });

        // Context analysis if available
        if (aiRecommendations.context_analysis) {
            components.push({
                type: "divider"
            });

            components.push({
                type: "text",
                text: "**Context Analysis**"
            });

            const analysis = aiRecommendations.context_analysis;
            let analysisText = '';

            if (analysis.sentiment) {
                analysisText += `- **Sentiment:** ${analysis.sentiment}\n`;
            }
            if (analysis.urgency) {
                analysisText += `- **Urgency:** ${analysis.urgency}\n`;
            }
            if (analysis.category) {
                analysisText += `- **Category:** ${analysis.category}\n`;
            }

            if (analysisText) {
                components.push({
                    type: "text",
                    text: analysisText.trim()
                });
            }
        }

        // Refresh button
        components.push({
            type: "divider"
        });
        components.push({
            type: "button",
            id: "refresh_replies",
            label: "🔄 Generate New Suggestions",
            style: "secondary",
            action: {
                type: "submit"
            }
        });

    } else {
        // No recommendations available
        components.push({
            type: "text",
            text: "⚠️ No AI recommendations were generated.\n\nThis might be due to insufficient conversation data or an issue with the AI service."
        });

        components.push({
            type: "button",
            id: "refresh_replies",
            label: "Try Again",
            style: "primary",
            action: {
                type: "submit"
            }
        });
    }

    return {
        canvas: {
            content: {
                components: components
            }
        }
    };
}

// Submit endpoint for handling Canvas actions
app.post('/submit', async (req, res) => {
    console.log('Submit request received:', JSON.stringify(req.body, null, 2));

    const componentId = req.body.component_id;
    const inputValues = req.body.input_values || {};
    const conversationId = req.body.conversation?.id || req.body.context?.conversation_id;
    const customerEmail = extractEmail(req.body);

    // Handle "Use This Reply" button click
    if (componentId && componentId.startsWith('use_reply_')) {
        const replyIndex = componentId.replace('use_reply_', '');
        const replyTextId = `reply_text_${replyIndex}`;
        const selectedReplyText = inputValues[replyTextId];

        if (selectedReplyText) {
            return res.json({
                canvas: {
                    content: {
                        components: [
                            {
                                type: "text",
                                text: "## ✅ Reply Ready"
                            },
                            {
                                type: "text",
                                text: "The following reply has been prepared. Copy it and paste into the conversation:"
                            },
                            {
                                type: "divider"
                            },
                            {
                                type: "textarea",
                                id: "final_reply",
                                label: "Your reply:",
                                value: selectedReplyText,
                                placeholder: "Reply text"
                            },
                            {
                                type: "divider"
                            },
                            {
                                type: "text",
                                text: "_Tip: Select all text in the box above (Cmd/Ctrl+A) and copy it (Cmd/Ctrl+C), then paste into the conversation reply box._"
                            },
                            {
                                type: "spacer",
                                size: "s"
                            },
                            {
                                type: "button",
                                id: "back_to_suggestions",
                                label: "← Back to Suggestions",
                                style: "secondary",
                                action: {
                                    type: "submit"
                                }
                            }
                        ]
                    }
                }
            });
        }
    }

    // Handle "Check Status" or "Generate New Suggestions" button
    if (componentId === 'refresh_now' || componentId === 'refresh_replies' || componentId === 'back_to_suggestions') {
        if (!conversationId) {
            return res.json({
                canvas: {
                    content: {
                        components: [
                            {
                                type: "text",
                                text: "❌ Cannot refresh - conversation ID not found. Please close and reopen the app."
                            }
                        ]
                    }
                }
            });
        }

        // Check cache for AI recommendations
        const cached = aiCache.get(conversationId);

        if (cached && cached.expiresAt > Date.now()) {
            // Check if error
            if (cached.error) {
                return res.json({
                    canvas: {
                        content: {
                            components: [
                                {
                                    type: "text",
                                    text: `❌ **Error**\n\nFailed to generate AI recommendations: ${cached.error}`
                                },
                                {
                                    type: "divider"
                                },
                                {
                                    type: "button",
                                    id: "refresh_now",
                                    label: "🔄 Try Again",
                                    style: "primary",
                                    action: {
                                        type: "submit"
                                    }
                                }
                            ]
                        }
                    }
                });
            }

            // AI recommendations are ready!
            if (cached.data) {
                console.log(`Cache hit: Returning AI recommendations for conversation ${conversationId}`);
                const canvasResponse = buildRecommendedRepliesCanvas(cached.data, cached.customerEmail, cached.messageCount);
                return res.json(canvasResponse);
            }
        }

        // Still processing or cache expired
        return res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: "# 🤖 AI Reply Assistant"
                        },
                        {
                            type: "text",
                            text: "⏳ **Still processing...**\n\nAI is analyzing the conversation. Please wait a moment and click 'Check Status' again."
                        },
                        {
                            type: "divider"
                        },
                        {
                            type: "button",
                            id: "refresh_now",
                            label: "🔄 Check Status",
                            style: "primary",
                            action: {
                                type: "submit"
                            }
                        }
                    ]
                }
            }
        });
    }

    // Default response for unknown actions
    res.json({
        canvas: {
            content: {
                components: [
                    {
                        type: "text",
                        text: "✅ **Action Completed**\n\nYour request has been processed successfully."
                    }
                ]
            }
        }
    });
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`API Base URL: ${API_BASE_URL || 'Not configured'}`);
    console.log(`API Token: ${API_TOKEN ? 'Configured' : 'Not configured'}`);
});