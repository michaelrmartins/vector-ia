const axios = require('axios');

const NASAJON_URL  = process.env.NASAJON_URL;
const NASAJON_USER = process.env.NASAJON_USER;
const NASAJON_PASS = process.env.NASAJON_PASS;

const authHeader = 'Basic ' + Buffer.from(`${NASAJON_USER}:${NASAJON_PASS}`).toString('base64');

async function registrarNoNasajon(documento) {
    const url = `${NASAJON_URL}/api/v1/funcionarios/${documento}`;

    try {
        const res = await axios.get(url, {
            headers: { Authorization: authHeader }
        });
        return res.data;
    } catch (err) {
        console.error('Nasajon integration error:', err.message);
        throw err;
    }
}

module.exports = { registrarNoNasajon };
