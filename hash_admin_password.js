const bcrypt = require('bcrypt');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter password to hash: ', (password) => {
  bcrypt.hash(password, 10, (err, hash) => {
    if (err) throw err;
    console.log('\nHashed password:');
    console.log(hash);
    rl.close();
  });
}); 