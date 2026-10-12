import { adoptEntraPassword } from '../entra_password_lifecycle.mjs';

const result = await adoptEntraPassword();
if (result.status === 'operation_failed') {
  console.error(
    `FAIL: microsoft_entra_adopt_password ${JSON.stringify(result)}`,
  );
  process.exitCode = 1;
} else {
  console.log(`PASS: Entra password ${result.status}`);
}
