// index.js
require('dotenv').config();
const axios = require('axios');
const Airtable = require('airtable');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const express = require('express');
const cors = require('cors');


// Configuration
const config = {
    airtable: {
        apiKey: process.env.AIRTABLE_API_KEY,
        baseId: process.env.AIRTABLE_BASE_ID
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY
    },
    logicApp: {
        url: process.env.LOGIC_APP_URL
    }
};

// Initialize services
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);
let airtableBase;

function initializeAirtable() {
    if (!config.airtable.apiKey || !config.airtable.baseId) {
        throw new Error('Missing required Airtable configuration');
    }
    return new Airtable({ apiKey: config.airtable.apiKey }).base(config.airtable.baseId);
}

// Teams message handling
// Modified sendTeamsMessage function to work with Logic App
// Modify the existing sendTeamsMessage function to include action handlers
async function sendTeamsMessage(summary, intakeId) {
    // Structure the message for Logic App with updated action handlers
    const message = {
        type: "message",
        attachments: [{
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
                type: "AdaptiveCard",
                version: "1.0",
                body: [
                    {
                        type: "TextBlock",
                        size: "Medium",
                        weight: "Bolder",
                        text: "Status Summary Review Required"
                    },
                    {
                        type: "TextBlock",
                        text: `Intake ID: ${intakeId}`,
                        wrap: true
                    },
                    {
                        type: "TextBlock",
                        text: summary,
                        wrap: true
                    },
                    {
                        type: "FactSet",
                        facts: [
                            {
                                title: "Status",
                                value: "Pending Review"
                            },
                            {
                                title: "Generated On",
                                value: new Date().toLocaleDateString()
                            }
                        ]
                    }
                ],
                actions: [
                    {
                        type: "Action.Submit",
                        title: "Approve",
                        data: {
                            msteams: {
                                type: "messageBack",
                                text: "approved"
                            },
                            actionId: "approve",
                            intakeId: intakeId,
                            summary: summary
                        }
                    },
                    {
                        type: "Action.Submit",
                        title: "Reject",
                        data: {
                            msteams: {
                                type: "messageBack",
                                text: "rejected"
                            },
                            actionId: "reject",
                            intakeId: intakeId
                        }
                    },
                    {
                        type: "Action.ShowCard",
                        title: "Modify",
                        card: {
                            type: "AdaptiveCard",
                            body: [
                                {
                                    type: "Input.Text",
                                    id: "modifiedText",
                                    placeholder: "Enter modified summary...",
                                    isMultiline: true,
                                    value: summary
                                }
                            ],
                            actions: [
                                {
                                    type: "Action.Submit",
                                    title: "Submit Modified",
                                    data: {
                                        msteams: {
                                            type: "messageBack",
                                            text: "modified"
                                        },
                                        actionId: "modify",
                                        intakeId: intakeId
                                    }
                                }
                            ]
                        }
                    }
                ]
            }
        }]
    };

    try {
        console.log('Sending message to Logic App:', JSON.stringify(message, null, 2));
        const response = await axios.post(config.logicApp.url, message);
        console.log('Logic App Response:', response.status, response.statusText);
        return true;
    } catch (error) {
        console.error('Error sending message:', error);
        return false;
    }
}

// Date handling utilities
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) throw new Error('Invalid date');
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (error) {
        console.error('Date formatting error:', error);
        return 'Invalid Date';
    }
}

function isWithinLastWeek(dateString, referenceDate = new Date()) {
    const date = new Date(dateString);
    const sevenDaysAgo = new Date(referenceDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return date >= sevenDaysAgo;
}

// Summary generation
async function generateBusinessSummary(notes) {
    if (!Array.isArray(notes) || notes.length === 0) {
        return 'No status updates available.';
    }

    try {
        const validNotes = notes
            .filter(note => note.addedOn && new Date(note.addedOn).getTime())
            .sort((a, b) => new Date(b.addedOn) - new Date(a.addedOn));

        if (validNotes.length === 0) return 'No valid status updates available.';

        const notesByCategory = {
            'Internal Note': validNotes.filter(n => n.category === 'Internal Note'),
            'Blocker / Challenge': validNotes.filter(n => n.category === 'Blocker / Challenge'),
            'Planned Action': validNotes.filter(n => n.category === 'Planned Action'),
            'Accomplishment': validNotes.filter(n => n.category === 'Accomplishment')
        };

        let summaryContent = await formatSummaryContent(validNotes, notesByCategory);
        return await generateAISummary(summaryContent);
    } catch (error) {
        console.error('Error in generateBusinessSummary:', error);
        return 'Error generating status summary.';
    }
}

async function formatSummaryContent(validNotes, notesByCategory) {
    const latestDate = formatDate(validNotes[0].addedOn);
    let content = `Status Summary (${latestDate})\n\n`;

    // Add recent updates
    const recentUpdates = [...notesByCategory['Internal Note'], ...notesByCategory['Accomplishment']]
        .sort((a, b) => new Date(b.addedOn) - new Date(a.addedOn))
        .slice(0, 3);

    if (recentUpdates.length > 0) {
        content += "Recent Updates:\n";
        recentUpdates.forEach(note => {
            content += `* ${formatDate(note.addedOn)}: ${note.notes}\n`;
        });
        content += '\n';
    }

    // Add blockers
    const blockers = notesByCategory['Blocker / Challenge'];
    if (blockers.length > 0) {
        content += "Current Blockers:\n";
        blockers.slice(0, 2).forEach(note => {
            content += `* ${formatDate(note.addedOn)}: ${note.notes}\n`;
        });
        content += '\n';
    }

    // Add planned actions
    const plannedActions = notesByCategory['Planned Action']
        .filter(note => new Date(note.addedOn) > new Date());
    
    if (plannedActions.length > 0) {
        content += "Planned Actions:\n";
        plannedActions.slice(0, 2).forEach(note => {
            content += `* ${formatDate(note.addedOn)}: ${note.notes}\n`;
        });
    }

    return content;
}

async function generateAISummary(summaryContent) {
    if (!config.gemini.apiKey) return summaryContent;

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        const prompt = `
          Create a concise project status summary (maximum 200 words) based on the following status notes, focusing on key updates and action items:
        ${summaryContent.content}

    Key Requirements:
    1. Begin with the current project phase and status (without percentage)
    2. Highlight the most critical updates from the last 2 weeks
    3. Identify any overdue items or items marked as "In Progress - Behind"
    4. Include upcoming key milestones or scheduled meetings
    5. Note any blockers or dependencies that need leadership attention
    6. Mention specific stakeholders only when relevant to leadership

    Format Guidelines:
    - Current Status: Start with overall project status and phase
    - Key Progress: List 2-3 most important recent developments
    - Challenges: Only include if there are active blockers/delays
    - Next Steps: Only include confirmed upcoming actions with dates

    Additional Rules:
    - Keep the summary under 200 words
    - Use professional, business-focused language
    - Include specific dates only when they appear in the source
    - Don't add speculative information or assumptions
    - Focus on actionable insights for leadership
    - If discussing delays, include current mitigation plans
    - Highlight items marked as "Leadership Attention" or "Blocker/Challenge"

    Format Structure:
    **Current Status:** Brief status and phase description
    **Key Progress:** 
    * 2-3 bullet points of recent key developments
    **Challenges:** [Only if present]
    * Current blockers or delays
    **Next Steps:**
    * Confirmed upcoming actions
    **Leadership Attention:** [Only if needed]
    * Critical items requiring leadership intervention
    `;
        const result = await model.generateContent(prompt);
        return result.response.text().trim();
    } catch (error) {
        console.error('Error generating AI summary:', error);
        return summaryContent;
    }
}

// Main processing function
async function processIntake(intakeId) {
    try {
        console.log(`Processing Intake ID: ${intakeId}`);
        airtableBase = initializeAirtable();

        const request = await getIntakeRequest(intakeId);
        if (!request) {
            throw new Error(`No request found for Intake ID: ${intakeId}`);
        }

        const notes = await getStatusNotes(intakeId);
        const formattedNotes = formatNotes(notes);
        const summary = await generateBusinessSummary(formattedNotes);
        
        const messageSent = await sendTeamsMessage(summary, intakeId);
        if (!messageSent) {
            throw new Error('Failed to send Teams message');
        }

        return { status: 'pending_approval', summary };
    } catch (error) {
        console.error('Error processing intake:', error);
        throw error;
    }
}

// API Server Setup
const app = express();
app.use(express.json());
app.use(cors());

app.use(cors({
    origin: '*',  // Be more specific in production
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// API Endpoints
app.post('/api/teams-response/:action', async (req, res) => {
    try {
        console.log('Teams response received:', {
            action: req.params.action,
            body: req.body,
            headers: req.headers
        });

        const { action } = req.params;
        const { intakeId, summary, modifiedText } = req.body;
        
        // Initialize Airtable if not already initialized
        if (!airtableBase) {
            airtableBase = initializeServices();
        }
        
        // Get the request record first
        const records = await airtableBase('Submitted Requests')
            .select({
                filterByFormula: `{Intake ID} = '${intakeId}'`
            })
            .firstPage();

        if (!records || records.length === 0) {
            throw new Error(`No record found for Intake ID: ${intakeId}`);
        }

        const request = records[0];
        let statusMessage = '';

        // Handle different actions
        switch(action) {
            case 'approve':
                await airtableBase('Submitted Requests').update(request.id, {
                    'Status Summary': summary,
                    'Status Summary Status': 'Approved'
                });
                statusMessage = 'Approved summary';
                break;

            case 'reject':
                await airtableBase('Submitted Requests').update(request.id, {
                    'Status Summary Status': 'Rejected'
                });
                statusMessage = 'Rejected summary';
                break;

            case 'modify':
                await airtableBase('Submitted Requests').update(request.id, {
                    'Status Summary': modifiedText,
                    'Status Summary Status': 'Approved'
                });
                statusMessage = 'Modified and approved summary';
                break;

            default:
                throw new Error(`Invalid action: ${action}`);
        }

        console.log(statusMessage, { intakeId, action });

        // Send confirmation message back to Teams
        const confirmationMessage = {
            type: "message",
            text: `Status summary ${action}ed for Intake ID: ${intakeId}`
        };
        
        if (config.logicApp.url) {
            await axios.post(config.logicApp.url, confirmationMessage);
        }

        res.json({ 
            success: true, 
            message: statusMessage,
            intakeId,
            action
        });
    } catch (error) {
        console.error('Error processing Teams response:', {
            error: error.message,
            stack: error.stack,
            action: req.params.action,
            intakeId: req.body?.intakeId
        });
        
        res.status(500).json({ 
            error: error.message,
            action: req.params.action,
            intakeId: req.body?.intakeId 
        });
    }
});
app.get('/', (req, res) => {
    console.log('Root route accessed');
    res.json({
        status: 'ok',
        message: 'Server is running'
    });
});

app.get('/test', (req, res) => {
    console.log('Test route accessed');
    res.json({
        status: 'running',
        message: 'Server is up and running!',
        timestamp: new Date().toISOString(),
        serverUrl: process.env.SERVER_URL
    });
});

// Your existing routes...

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Error occurred:', err);
    res.status(500).json({
        error: err.message,
        timestamp: new Date().toISOString()
    });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Helper functions
async function getIntakeRequest(intakeId) {
    const records = await airtableBase('Submitted Requests')
        .select({
            filterByFormula: `{Intake ID} = '${intakeId}'`,
            fields: ['Intake ID', 'Project Name']
        })
        .firstPage();
    return records[0];
}

async function getStatusNotes(intakeId) {
    return await airtableBase('Status Notes')
        .select({
            filterByFormula: `{Intake ID} = '${intakeId}'`,
            fields: ['Note Category', 'Notes', 'Added On', 'Added By']
        })
        .firstPage();
}

function formatNotes(notes) {
    return notes.map(record => ({
        category: record.fields['Note Category'],
        notes: record.fields['Notes'],
        addedOn: record.fields['Added On'],
        addedBy: record.fields['Added By']?.name || ''
    }));
}

async function updateAirtableStatus(intakeId, summary, status) {
    try {
        console.log('Updating Airtable:', {
            intakeId,
            status,
            summaryLength: summary?.length
        });

        const records = await airtableBase('Submitted Requests')
            .select({
                filterByFormula: `{Intake ID} = '${intakeId}'`
            })
            .firstPage();

        if (!records || records.length === 0) {
            throw new Error(`No record found for Intake ID: ${intakeId}`);
        }

        const recordId = records[0].id;
        const updateFields = {
            'Status Summary Status': status
        };
        
        if (summary !== null) {
            updateFields['Status Summary'] = summary;
        }

        await airtableBase('Submitted Requests').update(recordId, updateFields);
        console.log('Successfully updated Airtable status');
        return true;
    } catch (error) {
        console.error('Error updating Airtable:', error);
        return false;
    }
}

module.exports = {
    processIntake
};

// Add this test function
async function testLogicAppConnection() {
    const testMessage = {
        type: "message",
        attachments: [{
            contentType: "application/vnd.microsoft.card.adaptive",
            content: {
                type: "AdaptiveCard",
                version: "1.0",
                body: [
                    {
                        type: "TextBlock",
                        text: "Test Connection",
                        weight: "Bolder"
                    },
                    {
                        type: "TextBlock",
                        text: `Test message sent at: ${new Date().toLocaleString()}`
                    }
                ]
            }
        }]
    };

    try {
        console.log('Sending test message to Logic App URL:', config.logicApp.url);
        const response = await axios.post(config.logicApp.url, testMessage);
        console.log('Test successful:', response.status, response.statusText);
        return true;
    } catch (error) {
        console.error('Test failed:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        return false;
    }
}// Run if called directly
if (require.main === module) {
    testLogicAppConnection()
        .then(success => {
            if (!success) {
                console.log('Test failed, not proceeding with intake processing');
                return;
            }
            console.log('Test successful, processing intake...');
            return processIntake('DATA COE - 10035');
        })
        .then(result => {
            if (result) console.log('\nGenerated Summary:', result);
        })
        .catch(console.error);
}
