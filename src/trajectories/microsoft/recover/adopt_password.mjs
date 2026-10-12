import { adoptMicrosoftPassword } from '../password_lifecycle.mjs';

const result = await adoptMicrosoftPassword();
console.log(`PASS: Microsoft password operation ${result.status}`);
