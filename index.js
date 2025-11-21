import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const API_TOKEN = process.env.API_TOKEN;
const API_BASE_URL = process.env.API_BASE_URL;

app.use(express.json());

// Helper function to safely extract email from various possible locations in the request body
function extractEmail(body) {
    return body?.context?.customer?.email ||
           body?.context?.user?.email ||
           body?.context?.contact?.email ||
           body?.customer?.email ||
           body?.user?.email ||
           body?.input_values?.email ||
           "unknown@example.com";
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

    const email = extractEmail(req.body);
    console.log(`Extracted email: ${email}`);

    if (!API_TOKEN || !API_BASE_URL) {
        return res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: "⚠️ **Configuration Error**\n\nAPI credentials are not configured. Please set API_TOKEN and API_BASE_URL environment variables."
                        }
                    ]
                }
            }
        });
    }

    try {
        // Make API request to fetch user data
        const response = await fetch(`${API_BASE_URL}/users?email=${encodeURIComponent(email)}`, {
            method: 'GET',
            headers: {
                'X-Service-Token': API_TOKEN,
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                return res.json({
                    canvas: {
                        content: {
                            components: [
                                {
                                    type: "text",
                                    text: `ℹ️ **No Data Found**\n\nNo records found for email: ${email}`
                                }
                            ]
                        }
                    }
                });
            }
            throw new Error(`API responded with status: ${response.status}`);
        }

        const data = await response.json();
        console.log('API Response:', JSON.stringify(data, null, 2));

        // Build Canvas components based on received data
        const components = buildCanvasComponents(data, email);

        res.json({
            canvas: {
                content: {
                    components: components
                }
            }
        });

    } catch (error) {
        console.error('Error fetching data:', error);
        res.json({
            canvas: {
                content: {
                    components: [
                        {
                            type: "text",
                            text: `❌ **Error**\n\nFailed to fetch data: ${error.message}`
                        }
                    ]
                }
            }
        });
    }
});

// Build Canvas components from API data
function buildCanvasComponents(data, email) {
    const components = [];

    // Add header
    components.push({
        type: "text",
        text: `# 📊 User Information\n\n**Email:** ${email}`
    });

    components.push({
        type: "divider"
    });

    // Add your specific data formatting here based on your API response structure
    // This is a placeholder - customize based on your actual data structure
    if (data && Object.keys(data).length > 0) {
        components.push({
            type: "text",
            text: "**Data received from API:**"
        });

        // Example: Display some basic info
        components.push({
            type: "text",
            text: `\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``
        });
    } else {
        components.push({
            type: "text",
            text: "No data available for this user."
        });
    }

    components.push({
        type: "divider"
    });

    // Add action buttons (customize as needed)
    components.push({
        type: "button",
        label: "View Details",
        style: "primary",
        id: "view_details",
        action: {
            type: "url",
            url: `${API_BASE_URL}/dashboard?email=${encodeURIComponent(email)}`
        }
    });

    return components;
}

// Submit endpoint for handling Canvas actions
app.post('/submit', async (req, res) => {
    console.log('Submit request received:', JSON.stringify(req.body, null, 2));

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