import { adoptMicrosoftPassword } from '../password_lifecycle.mjs';

const result = await adoptMicrosoftPassword();
if (result.status === 'operation_failed')
  throw new Error(`microsoft_adopt_password failed: ${JSON.stringify(result)}`);
console.log(`PASS: Microsoft password ${result.status}`);
