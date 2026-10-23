import { createClient } from '@supabase/supabase-js';

/* =========================================================
   INICIALIZAÇÃO DO SUPABASE
   ========================================================= */
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/* =========================================================
   HANDLER
   ========================================================= */
export default async function handler(req, res) {

    /* =====================================================
       GET - Descobre o estado atual do sistema
       ===================================================== */
    if (req.method === 'GET') {
        try {
            const { data, error } = await supabase
                .from('estado_sistema')
                .select('modo')
                .eq('id', 1)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            const estado = data?.modo || "NORMAL";

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
        /* =================================================
           1. VERIFICAÇÃO DE EMERGÊNCIA
           ================================================= */
        const { data: configData } = await supabase
            .from('estado_sistema')
            .select('modo')
            .eq('id', 1)
            .single();

        const emEmergencia = configData?.modo === "EMERGENCIA";
        console.log("🚨 Emergência:", emEmergencia);

        /* =================================================
           2. LOCALIZA O ALUNO
           ================================================= */
        const { data: dadosAluno, error: erroAluno } = await supabase
            .from('alunos')
            .select('*')
            .eq('uid', tagLimpa)
            .single();

        if (erroAluno || !dadosAluno) {
            return res.status(404).json({
                success: false,
                message: "Aluno não encontrado!"
            });
        }

        /* =================================================
           3. INTELIGÊNCIA DE DESTINO
           ================================================= */
        let localTratado;

        if (emEmergencia) {
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

            // Registra o aluno na chamada do abandono
            await supabase
                .from('chamada_abandono')
                .upsert({
                    aluno_tag: tagLimpa,
                    nome: dadosAluno.nome,
                    turma: dadosAluno.turma || "N/A",
                    status: "SEGURO",
                    hora_chegada: agora.toLocaleTimeString('pt-BR'),
                    timestamp: agora.toISOString()
                }, { onConflict: 'aluno_tag' });

        } else if (localDestino === "DISPENSADO") {
            novoStatus = "ausente";
            localAtual = "FORA DA ESCOLA";
        }

        /* =================================================
           5. ATUALIZA ALUNO
           ================================================= */
        await supabase
            .from('alunos')
            .update({
                status: novoStatus,
                local_atual: localAtual,
                ultimo_registro: agora.toISOString()
            })
            .eq('uid', tagLimpa);

        /* =================================================
           6. FECHAMENTO DE MOVIMENTAÇÃO ANTERIOR
           ================================================= */
        const { data: movsAbertas } = await supabase
            .from('movimentacoes')
            .select('id')
            .eq('uid', tagLimpa)
            .eq('status', 'em_andamento');

        if (movsAbertas && movsAbertas.length > 0) {
            const idsParaFechar = movsAbertas.map(m => m.id);
            await supabase
                .from('movimentacoes')
                .update({
                    data_hora_retorno: agora.toISOString(),
                    status: "concluido",
                    retorno_autorizado_por: emEmergencia ? "EVACUAÇÃO" : (autorizadoPor || "SISTEMA")
                })
                .in('id', idsParaFechar);
        }

        /* =================================================
           7. HISTÓRICO DE MOVIMENTAÇÃO
           ================================================= */
        const statusMov = (localDestino === "SALA DE AULA" || localDestino === "DISPENSADO" || emEmergencia)
            ? "concluido"
            : "em_andamento";

        const registroHistorico = {
            uid: tagLimpa,
            nome: dadosAluno.nome,
            turma: dadosAluno.turma || "N/A",
            tipo: localDestino,
            local_destino: localDestino,
            data_hora_saida: agora.toISOString(),
            autorizado_por: autorizadoPor || "SISTEMA",
            tempo_limite: tempoLimiteDefinido,
            status: statusMov
        };

        if (statusMov === "concluido") {
            registroHistorico.data_hora_retorno = agora.toISOString();
        }

        await supabase
            .from('movimentacoes')
            .insert([registroHistorico]);

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
