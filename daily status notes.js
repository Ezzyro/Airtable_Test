const inputData = input.config();
const jsonData = inputData.jsonData;
let intakearr = inputData.records[0].split('|');
const intakeID = intakearr[0];
console.log(`Working with Intake ID: ${intakeID}`);

const cleanString = jsonData.replace(/"summary":\s*"{/g, '"summary": {')
                             .replace(/}"/g, '}')
                             .replace(/\n/g, '')
                             .trim();

const jsonObject = JSON.parse(cleanString);

const todaysDate = jsonObject["Todays Date"];
const accomplishment = jsonObject.summary.Accomplishment;
const dependency = jsonObject.summary.Dependency;
const blockers = jsonObject.summary.Blockers;
const internalNote = jsonObject.summary["Internal Note"];
const plannedActions = jsonObject.summary["Planned Action"];

output.set("todaysDate", todaysDate);
output.set("accomplishment", accomplishment);
output.set("dependency", dependency);
output.set("blocker", blockers);
output.set("internalNote", internalNote);
output.set("plannedActions", plannedActions);
output.set('IntakeID', intakeID);

let statusNotesTable = base.getTable('Status Notes');
let projectsTable = base.getTable('Projects');

// Get all records from the Status Notes table
let allRecords = await statusNotesTable.selectRecordsAsync({
    fields: ['Intake ID', 'Note Category', 'Notes', 'Added On']
});

// Filter records manually to find those with matching Intake ID
let matchingRecords = allRecords.records.filter(record => {
    const intakeIdValue = record.getCellValue('Intake ID');
    
    // Check if the Intake ID field has a value and is an array
    if (!intakeIdValue || !Array.isArray(intakeIdValue) || intakeIdValue.length === 0) {
        return false;
    }
    
    // Check if the name property of the first element matches our intake ID
    return intakeIdValue[0].name === intakeID;
});

console.log(`Found ${matchingRecords.length} existing records with Intake ID: ${intakeID}`);

// Create a map to store the latest record for each category
let latestRecordsByCategory = {
    'Accomplishment': null,
    'Planned Action': null,
    'Dependency': null,
    'Blocker / Challenge': null,
    'Internal Note': null
};

// Find the latest record for each category
for (let record of matchingRecords) {
    const categoryValue = record.getCellValue('Note Category');
    let category = '';
    
    // Extract category name based on its format
    if (typeof categoryValue === 'string') {
        category = categoryValue;
    } else if (categoryValue && typeof categoryValue === 'object') {
        category = categoryValue.name || '';
    }
    
    const dateAdded = record.getCellValue('Added On');
    
    // Skip if category is not one we're interested in
    if (!latestRecordsByCategory.hasOwnProperty(category)) {
        continue;
    }
    
    // If this is the first record for this category, or it's newer than what we have
    if (!latestRecordsByCategory[category] || 
        new Date(dateAdded) > new Date(latestRecordsByCategory[category].getCellValue('Added On'))) {
        latestRecordsByCategory[category] = record;
    }
}

// Map our variables to their categories for easier processing
const categoryData = {
    'Accomplishment': accomplishment,
    'Planned Action': plannedActions,
    'Dependency': dependency,
    'Blocker / Challenge': blockers,
    'Internal Note': internalNote
};

// Process each category
for (const [category, data] of Object.entries(categoryData)) {
    // Skip if no data for this category
    if (!data || data.trim() === '') {
        console.log(`Skipping category ${category}: no data`);
        continue;
    }
    
    console.log(`Processing category: ${category}`);
    const latestRecord = latestRecordsByCategory[category];
    
    // If we have a latest record for this category and it was added today
    if (latestRecord && latestRecord.getCellValue('Added On') === todaysDate) {
        console.log(`Updating existing record for ${category}`);
        // Update the existing record
        await statusNotesTable.updateRecordAsync(latestRecord, {
            'Notes': data
        });
    } else {
        console.log(`Creating new record for ${category}`);
        
        // First get the project record with matching Intake ID to get its ID
        let projectRecords = await projectsTable.selectRecordsAsync({
            fields: ['Intake ID'],
            filterByFormula: `{Intake ID} = '${intakeID}'`
        });
        
        let projectId = null;
        if (projectRecords.records.length > 0) {
            projectId = projectRecords.records[0].id;
            console.log(`Found project record with ID: ${projectId}`);
        } else {
            console.log(`Could not find project with Intake ID: ${intakeID}`);
            // Continue anyway, using the Intake ID value directly
        }
        
        try {
            // Create the new record with the correct format for Intake ID
            // If we found the project ID, use it; otherwise, use the Intake ID as name
            const intakeIdField = projectId ? 
                [{id: projectId}] : 
                [{name: intakeID}];
            
            await statusNotesTable.createRecordAsync({
                'Intake ID': intakeIdField,
                'Note Category': {name: category},
                'Notes': data
            });
            console.log(`Successfully created record for ${category}`);
        } catch (error) {
            console.log(`Error creating record for ${category}: ${error.message}`);
            
            // If first attempt fails, try with name approach
            try {
                await statusNotesTable.createRecordAsync({
                    'Intake ID': [{name: intakeID}],
                    'Note Category': {name: category},
                    'Notes': data
                });
                console.log(`Successfully created record with name approach for ${category}`);
            } catch (error2) {
                console.log(`Error with name approach: ${error2.message}`);
            }
        }
    }
}

output.set('processingComplete', true);
