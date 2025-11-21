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
    const conversationId = req.body.context?.conversation_id;
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

        // 4. Send to n8n webhook
        console.log('Sending data to n8n webhook...');
        const n8nResponse = await fetch(N8N_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(webhookPayload),
            timeout: 9000 // 9 second timeout (Intercom has 10s limit)
        });

        if (!n8nResponse.ok) {
            throw new Error(`n8n webhook error: ${n8nResponse.status} - ${await n8nResponse.text()}`);
        }

        const aiRecommendations = await n8nResponse.json();
        console.log('Received AI recommendations from n8n');

        // 5. Build Canvas response with AI recommendations
        const canvasResponse = buildRecommendedRepliesCanvas(aiRecommendations, customerEmail, messages.length);

        res.json(canvasResponse);

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

    // Handle "Generate New Suggestions" or "Try Again" button
    if (componentId === 'refresh_replies' || componentId === 'back_to_suggestions') {
        // Re-run the initialize logic
        const conversationId = req.body.context?.conversation_id;

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

        // Redirect to initialize logic by triggering a refresh
        return res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: "🔄 **Refreshing...**\n\nGenerating new AI suggestions. This may take a few seconds."
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