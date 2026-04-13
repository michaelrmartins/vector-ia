const axios = require('axios');

const NASAJON_URL  = process.env.NASAJON_URL  || 'http://192.168.55.9:8082';
const NASAJON_USER = process.env.NASAJON_USER || 'admin';
const NASAJON_PASS = process.env.NASAJON_PASS || 'fth67jil';

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
