const axios = require('axios');

async function registrarNoLyceum(matricula) {
    const url = `http://192.168.55.9:4000/api/v1/alunos/${matricula}`;

    try {
        const res = await axios.get(url);
        const aluno = res.data.data;

        if (aluno && aluno.sit_aluno === 'Ativo') {
            return aluno;
        }
        throw new Error('Student inactive or not found');
    } catch (err) {
        console.error('Lyceum integration error:', err.message);
        throw err;
    }
}

module.exports = { registrarNoLyceum };
