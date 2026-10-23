import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm&#39;;

/* =========================================================
   INICIALIZAÇÃO DO SUPABASE CLIENT
   ========================================================= */
const SUPABASE_URL = 'https://jrdzgddszylausmwgrxw.supabase.co&#39;;
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZHpnZGRzenlsYXVzbXdncnh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NzAwNDgsImV4cCI6MjEwNzE0NjA0OH0.6a9pbuSuabu9yP5zdtlemeIQYTXIB4ArauayEi5N-BY'; // Insira a sua chave anon public

const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let tempoInicial = Date.now();
let inicioEmergencia = 0;

/* =========================================================
   CRONÔMETRO
   ========================================================= */
function iniciarCronometro() {
    tempoInicial = Date.now();
    setInterval(() => {
        const agora = Date.now();
        const d = agora - tempoInicial;
        const h = Math.floor(d / 3600000).toString().padStart(2, '0');
        const m = Math.floor((d % 3600000) / 60000).toString().padStart(2, '0');
        const s = Math.floor((d % 60000) / 1000).toString().padStart(2, '0');
        const elCronometro = document.getElementById('cronometro');
        if (elCronometro) elCronometro.innerText = `${h}:${m}:${s}`;
    }, 1000);
}

/* =========================================================
   VERIFICAÇÃO DE SESSÃO LOCAL E ESCUTA SUPABASE
   ========================================================= */
if (sessionStorage.getItem('logado') !== 'true') {
    console.warn("⚠️ Acesso não autorizado na Emergência. Redirecionando...");
    window.location.replace("index.html");
} else {
    iniciarCronometro();
    inicializarEmergencia();
}

async function inicializarEmergencia() {
    // 1. Carrega o estado atual do sistema
    const { data: configData } = await supabaseClient
        .from('estado_sistema')
        .select('*')
        .eq('id', 1)
        .single();

    if (configData && configData.updated_at) {
        inicioEmergencia = new Date(configData.updated_at).getTime();
    }

    // 2. Processa a lista inicial de alunos
    await processarEvacuacao();

    // 3. Escuta em tempo real as tabelas 'alunos', 'chamada_abandono' e 'estado_sistema'
    supabaseClient
        .channel('realtime-emergencia-js')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alunos' }, async () => {
            await processarEvacuacao();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chamada_abandono' }, async () => {
            await processarEvacuacao();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'estado_sistema' }, (payload) => {
            if (payload.new && payload.new.modo === "NORMAL") {
                window.location.replace("telao.html");
            }
        })
        .subscribe();
}

/* =========================================================
   CÁLCULO E PROCESSAMENTO DE ALUNOS NA ÁREA SEGURA
   ========================================================= */
async function processarEvacuacao() {
    // Busca alunos presentes
    const { data: alunos, error: errAlunos } = await supabaseClient
        .from('alunos')
        .select('*')
        .eq('status', 'presente');

    // Busca registros da chamada do abandono
    const { data: seguros, error: errSeguros } = await supabaseClient
        .from('chamada_abandono')
        .select('aluno_tag');

    if (errAlunos || !alunos) return;

    const tagsSeguras = new Set(seguros ? seguros.map(s => s.aluno_tag) : []);

    let totalNaEscola = 0;
    let totalSeguros = 0;
    const listaPendentes = document.getElementById('lista-nomes-pendentes');
    if (listaPendentes) listaPendentes.innerHTML = '';

    alunos.forEach(aluno => {
        totalNaEscola++;

        const dataLeitura = aluno.ultimo_registro || aluno.ultima_atualizacao;
        const ultimaLeitura = dataLeitura ? new Date(dataLeitura).getTime() : 0;
        const local = (aluno.local_atual || "").toUpperCase();

        const bipouNaEmergencia = (ultimaLeitura + 5000) >= inicioEmergencia;
        const estaNaQuadra = (
            local.includes("QUADRA") ||
            local.includes("SEGURA") ||
            local.includes("AREA SEGURA") ||
            local.includes("ÁREA SEGURA")
        ) && bipouNaEmergencia;

        const estaSeguro = estaNaQuadra || tagsSeguras.has(aluno.uid);

        if (estaSeguro) {
            totalSeguros++;
        } else {
            if (listaPendentes) {
                const li = document.createElement('li');
                const identificacaoTurma = aluno.turma ? ` (${aluno.turma})` : '';
                li.innerHTML = `<strong>${aluno.nome}</strong>${identificacaoTurma}`;
                listaPendentes.appendChild(li);
            }
        }
    });

    const totalPendentes = Math.max(0, totalNaEscola - totalSeguros);

    const elPresentes = document.getElementById('total-presentes');
    const elSeguros = document.getElementById('total-seguros');
    const elPendentes = document.getElementById('total-pendentes');

    if (elPresentes) elPresentes.innerText = totalNaEscola;
    if (elSeguros) elSeguros.innerText = totalSeguros;
    if (elPendentes) elPendentes.innerText = totalPendentes;

    // Liberação do botão de relatório final
    const btnRelatorio = document.getElementById('btn-stop');
    if (btnRelatorio) {
        if (totalPendentes === 0 && totalNaEscola > 0) {
            btnRelatorio.disabled = false;
            btnRelatorio.style.opacity = "1";
            btnRelatorio.style.cursor = "pointer";
            btnRelatorio.onclick = () => window.gerarRelatorioAbandono();
        } else {
            btnRelatorio.disabled = true;
            btnRelatorio.style.opacity = "0.5";
            btnRelatorio.style.cursor = "not-allowed";
        }
    }
}

/* =========================================================
   EMISSÃO DE RELATÓRIO E ENCERRAMENTO
   ========================================================= */
window.gerarRelatorioAbandono = function() {
    const tempoEvacuacao = document.getElementById('cronometro')?.innerText || "00:00:00";
    const totalPresentes = document.getElementById('total-presentes')?.innerText || "0";
    const totalSeguros = document.getElementById('total-seguros')?.innerText || "0";
    const dataAtual = new Date().toLocaleDateString('pt-BR') + " às " + new Date().toLocaleTimeString('pt-BR');

    const elData = document.getElementById('data-relatorio');
    if (elData) elData.innerText = dataAtual;

    const areaRelatorio = document.getElementById('conteudo-impressao');
    if (areaRelatorio) {
        areaRelatorio.innerHTML = `
            <div style="border: 1px solid #000; padding: 20px; border-radius: 8px;">
                <p><strong>Status do Protocolo:</strong> CONCLUÍDO COM SUCESSO</p>
                <p><strong>Tempo Total de Evacuação:</strong> ${tempoEvacuacao}</p>
                <p><strong>Total de Alunos na Unidade:</strong> ${totalPresentes}</p>
                <p><strong>Alunos Confirmados na Zona Segura:</strong> ${totalSeguros}</p>
                <p><strong>Pendências Finais:</strong> 0 (Cento por cento de aproveitamento)</p>
                <br>
                <p style="font-size: 0.9rem; font-style: italic;">Certificamos que todos os protocolos de segurança foram seguidos e a zona segura foi atingida dentro do tempo previsto.</p>
            </div>
        `;
    }

    window.print();

    setTimeout(() => {
        window.voltarNormalidade();
    }, 500);
};

window.voltarNormalidade = async function() {
    if (confirm("Encerrar protocolo?")) {
        try {
            await supabaseClient
                .from('estado_sistema')
                .update({ modo: "NORMAL", updated_at: new Date().toISOString() })
                .eq('id', 1);

            await supabaseClient
                .from('chamada_abandono')
                .delete()
                .neq('id', 0);

            window.location.replace("telao.html");
        } catch (e) {
            alert("Erro ao conectar com o banco de dados.");
        }
    }
};
