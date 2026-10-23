import admin from 'firebase-admin';

/* =========================================================
   INICIALIZAÇÃO DO FIREBASE ADMIN
   ========================================================= */

if (!admin.apps.length) {
    const rawKey = process.env.FIREBASE_PRIVATE_KEY;
    const privateKey = rawKey
        ? rawKey.replace(/^"(.*)"$/, '$1').replace(/\\n/g, '\n')
        : undefined;

    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: privateKey
        }),
        databaseURL: process.env.FIREBASE_DATABASE_URL
    });
}

const db = admin.database();

/* =========================================================
   HANDLER
   ========================================================= */

export default async function handler(req, res) {

    /* =====================================================
       GET - Usado pelo scanner apenas para descobrir o estado atual do sistema.
       ===================================================== */
    if (req.method === 'GET') {
        try {
            const snapshot = await db.ref('configuracao/estado_sistema').once('value');
            const estado = snapshot.val() || "NORMAL";

            return res.status(200).json({
                success: true,
                estado: estado
            });
        } catch (error) {
            console.error("Erro ao consultar estado:", error);
            return res.status(500).json({
                success: false,
                message: "Erro ao consultar estado do sistema."
            });
        }
    }

    /* =====================================================
       SOMENTE POST PARA BIPAGEM
       ===================================================== */
    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            message: 'Método não permitido'
        });
    }

    let { alunoTag, localDestino, autorizadoPor } = req.body;

    if (!alunoTag) {
        return res.status(400).json({
            success: false,
            message: "Tag do aluno é obrigatória!"
        });
    }

    const agora = new Date();
    const tagLimpa = alunoTag.toString().trim().replace(/[\r\n]/g, "");

    try {
        const configRef = db.ref('configuracao');
        const alunosRef = db.ref('alunos');
        const movRef = db.ref('movimentacoes');

        /* =================================================
           1. VERIFICAÇÃO DE EMERGÊNCIA
           ================================================= */
        const snapshotConfig = await configRef.child('estado_sistema').once('value');
        const emEmergencia = snapshotConfig.val() === "EMERGENCIA";

        console.log("🚨 Emergência:", emEmergencia);

        /* =================================================
           2. LOCALIZA O ALUNO
           ================================================= */
        const snapshotAlunos = await alunosRef.orderByChild('tag').equalTo(tagLimpa).once('value');

        if (!snapshotAlunos.exists()) {
            return res.status(404).json({
                success: false,
                message: "Aluno não encontrado!"
            });
        }

        const alunoKey = Object.keys(snapshotAlunos.val())[0];
        const dadosAluno = snapshotAlunos.val()[alunoKey];

        /* =================================================
           3. INTELIGÊNCIA DE DESTINO
           ================================================= */
        let localTratado;

        if (emEmergencia) {
            /*
             * REGRA ABSOLUTA:
             * Durante o Plano de Abandono, o destino enviado pelo celular é ignorado.
             */
            localTratado = "AREA SEGURA";
            autorizadoPor = "PLANO DE ABANDONO";
        } else {
            const localEntrada = localDestino || "SALA DE AULA";
            localTratado = localEntrada.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();

            if (localTratado === "BANHEIRO") {
                const sexo = (dadosAluno.sexo || "F").toUpperCase();
                localTratado = (sexo === "M") ? "BWC MASCULINO" : "BWC FEMININO";
            }
        }

        const LIMITES = {
            "BEBEDOURO": 3,
            "BWC MASCULINO": 6,
            "BWC FEMININO": 6,
            "AREA SEGURA": 0
        };

        const tempoLimiteDefinido = LIMITES[localTratado] ?? 10;
        localDestino = localTratado;

        /* =================================================
           4. STATUS DO ALUNO
           ================================================= */
        let novoStatus = "presente";
        let localAtual = localDestino;

        if (emEmergencia) {
            novoStatus = "presente";
            localAtual = "ÁREA SEGURA";

            const dadosSeguranca = {
                status: "SEGURO",
                hora_chegada: agora.toLocaleTimeString('pt-BR'),
                nome: dadosAluno.nome,
                turma: dadosAluno.turma || "N/A",
                timestamp: agora.toISOString()
            };

            /*
             * Registra o aluno na chamada do abandono.
             */
            await db.ref(`chamada_abandono/${alunoKey}`).update(dadosSeguranca);
            await db.ref(`chamada_abandono/${tagLimpa}`).update(dadosSeguranca);

        } else if (localDestino === "DISPENSADO") {
            novoStatus = "ausente";
            localAtual = "FORA DA ESCOLA";
        }

        /* =================================================
           5. ATUALIZA ALUNO
           ================================================= */
        await alunosRef.child(alunoKey).update({
            status: novoStatus,
            local_atual: localAtual,
            ultima_leitura: agora.toISOString(),
            ultima_atualizacao: agora.toISOString()
        });

        /* =================================================
           6. FECHAMENTO DE MOVIMENTAÇÃO ANTERIOR
           ================================================= */
        const snapshotMov = await movRef.orderByChild('aluno_tag').equalTo(tagLimpa).once('value');

        if (snapshotMov.exists()) {
            const registros = snapshotMov.val();
            const chaveAberta = Object.keys(registros).find(
                key => registros[key].status === 'em_andamento'
            );

            if (chaveAberta || emEmergencia) {
                const chaveParaFechar = chaveAberta || Object.keys(registros).pop();

                await movRef.child(chaveParaFechar).update({
                    data_hora_retorno: agora.toISOString(),
                    status: "concluido",
                    retorno_autorizado_por: emEmergencia ? "EVACUAÇÃO" : (autorizadoPor || "SISTEMA")
                });
            }
        }

        /* =================================================
           7. HISTÓRICO DE MOVIMENTAÇÃO
           ================================================= */
        const registroHistorico = {
            aluno_tag: tagLimpa,
            nome: dadosAluno.nome,
            local_destino: localDestino,
            data_hora_saida: agora.toISOString(),
            autorizado_por: autorizadoPor || "SISTEMA",
            turma: dadosAluno.turma || "N/A",
            tempo_limite: tempoLimiteDefinido,
            status: (localDestino === "SALA DE AULA" || localDestino === "DISPENSADO" || emEmergencia)
                ? "concluido"
                : "em_andamento"
        };

        if (localDestino === "SALA DE AULA" || localDestino === "DISPENSADO" || emEmergencia) {
            registroHistorico.data_hora_retorno = agora.toISOString();
        }

        await movRef.push(registroHistorico);

        /* =================================================
           8. RESPOSTA
           ================================================= */
        return res.status(200).json({
            success: true,
            nome: dadosAluno.nome,
            local: localDestino,
            mensagem: emEmergencia ? "ALUNO EM ÁREA SEGURA" : "REGISTRO CONFIRMADO"
        });

    } catch (error) {
        console.error("Erro no processamento do Scanner:", error);
        return res.status(500).json({
            success: false,
            message: error.message
        });
    }
}
