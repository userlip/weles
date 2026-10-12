import { rotateMicrosoftPassword } from '../password_lifecycle.mjs';

const result = await rotateMicrosoftPassword();
console.log(`PASS: Microsoft password operation ${result.status}`);
