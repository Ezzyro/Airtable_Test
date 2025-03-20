let inputConfig = input.config();
console.log(inputConfig);
let intakearr=inputConfig.records.split(' |');
const intakeID=intakearr[0];
output.set('IntakeID',intakeID);
