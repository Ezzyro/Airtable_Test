require('dotenv').config();
const Airtable = require('airtable');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Configuration
const config = {
    airtable: {
        apiKey: process.env.AIRTABLE_API_KEY,
        baseId: process.env.AIRTABLE_BASE_ID
    },
    gemini: {
        apiKey: process.env.GEMINI_API_KEY
    }
};

// Initialize Generative AI
const genAI = new GoogleGenerativeAI(config.gemini.apiKey);

// Initialize Airtable
function initializeServices() {
    if (!config.airtable.apiKey || !config.airtable.baseId) {
        throw new Error('Missing required Airtable configuration');
    }
    return new Airtable({ apiKey: config.airtable.apiKey }).base(config.airtable.baseId);
}

// Format date helper
function formatDate(dateString) {
    try {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            throw new Error('Invalid date');
        }
        return date.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric'
        });
    } catch (error) {
        console.error('Date formatting error:', error);
        return 'Invalid Date';
    }
}

// Function to determine if a date is within the last 7 days
function isWithinLastWeek(dateString, referenceDate = new Date()) {
    const date = new Date(dateString);
    const sevenDaysAgo = new Date(referenceDate);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return date >= sevenDaysAgo;
}

// Generate business analysis summary
async function generateBusinessSummary(notes) {
    if (!Array.isArray(notes) || notes.length === 0) {
        return 'No status updates available.';
    }

    try {
        // Validate and sort notes by date
        const validNotes = notes
            .filter(note => note.addedOn && new Date(note.addedOn).getTime())
            .sort((a, b) => new Date(b.addedOn) - new Date(a.addedOn));

        if (validNotes.length === 0) {
            return 'No valid status updates available.';
        }

        // Group notes by category
        const notesByCategory = {
            'Internal Notes': validNotes.filter(n => n.category === 'Internal Notes'),
            'Blockers / Challenges': validNotes.filter(n => n.category === 'Blockers / Challenges'),
            'Planned Actions': validNotes.filter(n => n.category === 'Planned Actions'),
            'Accomplishments': validNotes.filter(n => n.category === 'Accomplishments')
        };

        const latestDate = formatDate(validNotes[0].addedOn);
        let summaryContent = `Project Status Summary (as of ${latestDate})\n\n`;

        // Track if we have recent activity
        const hasRecentActivity = validNotes.some(note => isWithinLastWeek(note.addedOn));
        const hasBlockers = notesByCategory['Blockers / Challenges'].length > 0;
        
        // Determine project status
        const projectStatus = hasBlockers ? 'Blocked' : (hasRecentActivity ? 'Active' : 'No Recent Activity');

        // Add sections with date validation
        let hasContent = false;

        // Combine Internal Notes and Accomplishments for Latest Updates
        const recentUpdates = [
            ...notesByCategory['Internal Notes'],
            ...notesByCategory['Accomplishments']
        ].sort((a, b) => new Date(b.addedOn) - new Date(a.addedOn));

        if (recentUpdates.length > 0) {
            summaryContent += "Latest Updates:\n";
            recentUpdates
                .slice(0, 3)
                .forEach(note => {
                    summaryContent += `${formatDate(note.addedOn)}: ${note.notes}\n`;
                });
            summaryContent += '\n';
            hasContent = true;
        }

        // Add current blockers
        if (notesByCategory['Blockers / Challenges'].length > 0) {
            summaryContent += "Current Blockers:\n";
            notesByCategory['Blockers / Challenges']
                .slice(0, 2)
                .forEach(note => {
                    summaryContent += `${formatDate(note.addedOn)}: ${note.notes}\n`;
                });
            summaryContent += '\n';
            hasContent = true;
        }

        // Add planned actions - only show if they're newer than the latest update
        const latestNoteDate = new Date(validNotes[0].addedOn);

        // Extract future dates from notes
        function extractFutureDate(text) {
            // Look for dates in format like "January 17, 2025" or "Jan 17"
            const dateMatches = text.match(/(?:January|Jan|February|Feb|March|Mar|April|Apr|May|June|Jun|July|Jul|August|Aug|September|Sep|October|Oct|November|Nov|December|Dec)\s+\d{1,2}(?:,?\s+\d{4})?/gi);
            
            if (dateMatches) {
                for (const match of dateMatches) {
                    // Add current year if year is not specified
                    const dateStr = match.includes(',') ? match : `${match}, ${latestNoteDate.getFullYear()}`;
                    const date = new Date(dateStr);
                    if (date > latestNoteDate) {
                        return date;
                    }
                }
            }
            return null;
        }

        // Find next steps by looking for future dates or ETAs
        const nextSteps = validNotes
            .filter(note => {
                const noteDate = new Date(note.addedOn);
                const futureDate = extractFutureDate(note.notes);
                const hasETA = note.notes.toLowerCase().includes('eta');
                
                // Include note if:
                // 1. It mentions a future date, or
                // 2. It contains "ETA" and is from within last 7 days
                return (futureDate !== null) || 
                       (hasETA && isWithinLastWeek(note.addedOn, latestNoteDate));
            })
            .sort((a, b) => new Date(b.addedOn) - new Date(a.addedOn));

        if (nextSteps.length > 0) {
            summaryContent += "Next Steps:\n";
            nextSteps
                .slice(0, 2)
                .forEach(note => {
                    const futureDate = extractFutureDate(note.notes);
                    summaryContent += `- Target: ${futureDate ? formatDate(futureDate) : 'Pending'} | ${note.notes}\n`;
                });
            hasContent = true;
        }

        if (!hasContent) {
            summaryContent += "No recent updates available.\n";
        }

        // Get AI enhanced summary
        return await getGeminiSummary({
            content: summaryContent,
            metadata: {
                projectStatus,
                totalUpdates: validNotes.length,
                hasBlockers,
                latestUpdate: latestDate
            }
        });

    } catch (error) {
        console.error('Error generating business summary:', error);
        return 'Error generating status summary.';
    }
}

// Gemini AI Summary Generation
async function getGeminiSummary(summaryData) {
    if (!config.gemini.apiKey) {
        return summaryData.content;
    }

    try {
        const model = genAI.getGenerativeModel({ model: "gemini-pro" });
        
        const prompt = `
          Create a concise project status summary (maximum 200 words) based on the following status notes, focusing on key updates and action items:
        ${summaryData.content}

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
        console.error('Error calling Gemini API:', error);
        return summaryData.content; // Fallback to original content
    }
}

// Main function to process single intake
async function testSingleIntake(intakeId) {
    const base = initializeServices();
    try {
        console.log(`Processing Intake ID: ${intakeId}`);

        // Get the Submitted Request record
        const requests = await new Promise((resolve, reject) => {
            base('Submitted Requests')
                .select({
                    filterByFormula: `{Intake ID} = '${intakeId}'`,
                    fields: ['Intake ID', 'Project Name']
                })
                .firstPage((err, records) => {
                    if (err) reject(err);
                    else resolve(records);
                });
        });

        if (!requests.length) {
            console.log(`No Submitted Request found for Intake ID: ${intakeId}`);
            return;
        }

        const request = requests[0];
        console.log(`Found request: ${request.fields['Project Name']}`);

        // Get all status notes
        const notes = await new Promise((resolve, reject) => {
            base('Status Notes')
                .select({
                    filterByFormula: `{Intake ID} = '${intakeId}'`,
                    fields: ['Note Category', 'Notes', 'Added On', 'Added By']
                })
                .firstPage((err, records) => {
                    if (err) reject(err);
                    else resolve(records);
                });
        });

        console.log(`Found ${notes.length} status notes`);

        const formattedNotes = notes.map(record => ({
            category: record.fields['Note Category'],
            notes: record.fields['Notes'],
            addedOn: record.fields['Added On'],
            addedBy: record.fields['Added By']?.name || ''
        }));

        // Generate business-focused summary
        const summary = await generateBusinessSummary(formattedNotes);

        // Update the summary in Airtable
        await base('Submitted Requests').update(request.id, {
            'Status Summary': summary
        });

        console.log('✓ Update completed successfully');
        return summary;

    } catch (error) {
        console.error('Error processing intake:', error);
        throw error;
    }
}

// Export the module
module.exports = {
    testSingleIntake
};

// Run the process if this is the main module
if (require.main === module) {
    testSingleIntake('DATA COE - 10035')
        .then(summary => {
            console.log('\nGenerated Summary:');
            console.log(summary);
        })
        .catch(console.error);
}
