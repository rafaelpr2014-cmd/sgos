const mysql = require("mysql2");

// Criando pool de conexões
const db = mysql.createPool({
  host: "187.77.249.210",
  user: "sgosremote",
  password: "Rpr!@#2793@#1603",
  database: "sgos",
  port: 3306,
  ssl: {
    rejectUnauthorized: false
  },
  dateStrings: true,
  timezone: 'Z',  // UTC
  connectionLimit: 10
});

// Força o timezone na conexão
db.on('connection', function(connection) {
  connection.query("SET time_zone='-03:00'");
});

// Exporta **já com promises** para evitar chamar db.promise() em todo lugar
module.exports = db.promise();