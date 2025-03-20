// Get the input containing the issue IDs
let inputConfig = input.config();
let issueIdsInput = inputConfig['issueIds'];

// Parse the input into an array of issue IDs
let parentIssueIds = [];

if (typeof issueIdsInput === 'string') {
    parentIssueIds = issueIdsInput.split(',').map(id => id.trim());
} else if (Array.isArray(issueIdsInput)) {
    parentIssueIds = issueIdsInput.map(id => id.toString().trim());
} else if (issueIdsInput) {
    parentIssueIds = issueIdsInput.toString().split(',').map(id => id.trim());
}

// Get the Jira Sync table
let jiraSyncTable = base.getTable("JIRA Sync");

// Query all records from the Jira Sync table
let allRecords = await jiraSyncTable.selectRecordsAsync({
    fields: ["Issue Key", 'Parent','Parent Epic',"Comments"]
});

// Array to store the final output
let finalOutput = [];

// Find and collect matching records
for (let record of allRecords.records) {
    let parentRaw = record.getCellValue('Parent');
    let parentString = record.getCellValueAsString('Parent');
    
    for (let parentId of parentIssueIds) {
        let isMatch = false;
        
        if (parentString && parentString.includes(parentId)) {
            isMatch = true;
        } else if (parentRaw) {
            if (Array.isArray(parentRaw)) {
                isMatch = parentRaw.some(p => 
                    (p.name && p.name.includes(parentId)) ||
                    (p.id && p.id.includes(parentId))
                );
            } else if (typeof parentRaw === 'object') {
                isMatch = (parentRaw.name && parentRaw.name.includes(parentId)) ||
                          (parentRaw.id && parentRaw.id.includes(parentId));
            }
        }
        
        if (isMatch) {
            // Add record to the output array with just the requested columns
            finalOutput.push({
                "Parent Epic": parentId,
                "Comments": record.getCellValueAsString("Comments") || ""
            });
            break;
        }
    }
}

// Set the consolidated output
console.log(finalOutput);
output.set('matchingIssues', finalOutput);
