const mysql = require("mysql2");

// Criando pool de conexões
const db = mysql.createPool({
  host: "metro.proxy.rlwy.net",
  user: "root",
  password: "pvwdMUHaBcUnRPFvRCIgoVWdAADxafkf",
  database: "railway",
  port: 33435,
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