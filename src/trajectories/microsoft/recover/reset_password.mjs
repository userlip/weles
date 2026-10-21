import { rotateMicrosoftPassword } from '../password_lifecycle.mjs';

const result = await rotateMicrosoftPassword();
if (result.status === 'operation_failed')
  throw new Error(`microsoft_reset_password failed: ${JSON.stringify(result)}`);
console.log(`PASS: Microsoft password ${result.status}`);
