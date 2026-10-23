import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js&quot;;
import { getDatabase, ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js&quot;;
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js&quot;;

const firebaseConfig = {
    apiKey: "minha API",
    authDomain: "meu domínio",
    databaseURL: "meu URL",
    projectId: "meu ID"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);

let tempoInicial;

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

onAuthStateChanged(auth, (user) => {
    if (user) {
        console.log("🔒 Autenticação confirmada na Emergência. UID:", user.uid);

        // Ouve a configuração de início de emergência
        const configRef = ref(db, 'configuracao/inicio_emergencia');
        onValue(configRef, (configSnap) => {
            const inicioEmergenciaStr = configSnap.val();
           
            // Se o timestamp não existir, usa 0 (qualquer bip posterior conta)
            const inicioEmergencia = inicioEmergenciaStr ? new Date(inicioEmergenciaStr).getTime() : 0;

            const alunosRef = ref(db, 'alunos');
            onValue(alunosRef, (snapshot) => {
                const dados = snapshot.val();
                if (!dados) return;

                let totalNaEscola = 0;
                let totalSeguros = 0;
                const listaPendentes = document.getElementById('lista-nomes-pendentes');
                if (listaPendentes) listaPendentes.innerHTML = '';

                for (let id in dados) {
                    const aluno = dados[id];

                    // Processa alunos com status "presente"
                    if (aluno.status === "presente") {
                        totalNaEscola++;

                        // Resgata o horário da última leitura ou atualização
                        const dataLeitura = aluno.ultima_leitura || aluno.ultima_atualizacao;
                        const ultimaLeitura = dataLeitura ? new Date(dataLeitura).getTime() : 0;
                        const local = (aluno.local_atual || "").toUpperCase();

                        // O aluno é considerado Seguro se:
                        // 1. Está no local QUADRA ou ÁREA SEGURA (normalizado)
                        // 2. A bipagem foi registrada após acionar a emergência (com margem de 5s)
                        const bipouNaEmergencia = (ultimaLeitura + 5000) >= inicioEmergencia;
                        const estaNaQuadra = (
                            local.includes("QUADRA") ||
                            local.includes("SEGURA") ||
                            local.includes("AREA SEGURA") ||
                            local.includes("ÁREA SEGURA")
                        ) && bipouNaEmergencia;

                        if (estaNaQuadra) {
                            totalSeguros++;
                        } else {
                            if (listaPendentes) {
                                const li = document.createElement('li');
                                const identificacaoTurma = aluno.turma ? ` (${aluno.turma})` : '';
                                li.innerText = `${aluno.nome}${identificacaoTurma}`;
                                listaPendentes.appendChild(li);
                            }
                        }
                    }
                }

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
            });
        });

    } else {
        console.warn("⚠️ Acesso não autorizado na Emergência. Redirecionando...");
        window.location.replace("index.html");
    }
});

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
            await update(ref(db, 'configuracao'), { estado_sistema: "NORMAL" });
            window.location.replace("telao.html");
        } catch (e) {
            alert("Erro ao conectar com o banco.");
        }
    }
};

iniciarCronometro();
