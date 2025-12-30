const azureDevOps = require('azure-devops-node-api');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const readline = require('readline');
require('dotenv').config();

// Configurações
const ORG_URL = process.env.ORG_URL;
const ADO_PAT = process.env.ADO_PAT;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const FIELD_UPDATE_ANALYSIS = process.env.FIELD_UPDATE_ANALYSIS;

const askQuestion = (query) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(query, ans => { rl.close(); resolve(ans); }));
};

async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on("data", (data) => chunks.push(data instanceof Buffer ? data : Buffer.from(data)));
        readableStream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        readableStream.on("error", reject);
    });
}

async function extrairCodigoPR(gitApi, prId) {
    console.log(`\nBaixando código do PR #${prId}...`);
    
    try {
        const prDetails = await gitApi.getPullRequestById(prId);
        
        if (!prDetails) {
            console.log(`Erro: PR #${prId} não encontrado.`);
            return "";
        }

        const repoId = prDetails.repository.id;
        const projectName = prDetails.repository.project.name;
        const prTitle = prDetails.title;

        // Cabeçalho para separar os contextos dos PRs na IA
        let prContext = `\n\n################################################\n`;
        prContext += `### INÍCIO DO PR #${prId}: ${prTitle}\n`;
        prContext += `################################################\n`;

        const diffs = await gitApi.getPullRequestIterations(repoId, prId);
        if (!diffs || diffs.length === 0) {
            return prContext + "   (Nenhuma iteração/código encontrado neste PR)\n";
        }

        const lastIterationId = diffs[diffs.length - 1].id;
        const changes = await gitApi.getPullRequestIterationChanges(repoId, prId, lastIterationId);

        let filesFound = 0;

        if (changes && changes.changeEntries) {
            for (const entry of changes.changeEntries) {
                const itemData = entry.item;
                const changeType = entry.changeType;

                if (!itemData || changeType === 16 || itemData.isFolder) continue;

                const path = itemData.path;
                const objectId = itemData.objectId;

                try {
                    const blobStream = await gitApi.getBlobContent(repoId, objectId, projectName, true);
                    const contentText = await streamToString(blobStream);

                    if (contentText.indexOf('\0') !== -1) continue; // Ignora binários

                    prContext += `\n--- ARQUIVO: ${path} ---\n`;
                    prContext += contentText + "\n";
                    filesFound++;

                } catch (err) {
                    console.log(`Erro ao ler ${path}: ${err.message}`);
                }
            }
        }
        
        console.log(`${filesFound} arquivos extraídos do PR #${prId}.`);
        return prContext;

    } catch (error) {
        console.log(`Falha ao extrair PR #${prId}: ${error.message}`);
        return "";
    }
}

async function main() {
    console.log("Iniciando Validador de Requisitos (Modo Consolidado)...");

    if (!ADO_PAT || !GOOGLE_API_KEY) process.exit(1);

    try {
        const authHandler = azureDevOps.getPersonalAccessTokenHandler(ADO_PAT);
        const connection = new azureDevOps.WebApi(ORG_URL, authHandler);
        const gitApi = await connection.getGitApi();
        const workItemApi = await connection.getWorkItemTrackingApi();

        console.log("Escolha o modo de operação:");
        console.log("1 - Analisar um Pull Request (e vincular ao Card)");
        console.log("2 - Analisar um Card (e TODOS os PRs vinculados)");
        
        const modeInput = await askQuestion("-> Digite 1 ou 2: ");
        const idInput = await askQuestion("-> Digite o ID: ");
        const ID = parseInt(idInput.trim());

        if (!ID) { console.error("ID inválido."); process.exit(1); }

        let wiId = null;
        let prsParaAnalisar = new Set();

        if (modeInput.trim() === '1') {
            console.log(`\nBuscando Card vinculado ao PR ${ID}...`);
            const pr = await gitApi.getPullRequestById(ID);
            const workItemRefs = await gitApi.getPullRequestWorkItemRefs(pr.repository.id, ID);

            if (!workItemRefs || workItemRefs.length === 0) {
                console.error("Nenhum Card vinculado a este PR.");
                return;
            }
            wiId = parseInt(workItemRefs[0].url.split('/').pop());
            prsParaAnalisar.add(ID);
        } else {
            console.log(`\nBuscando PRs vinculados ao Card ${ID}...`);
            wiId = ID;
            const workItemCheck = await workItemApi.getWorkItem(wiId, null, null, 1);
            if (workItemCheck.relations) {
                workItemCheck.relations.forEach(rel => {
                    const url = rel.url ? rel.url.toLowerCase() : '';
                    if (url.includes('pullrequestid')) {
                        const decodedUrl = decodeURIComponent(rel.url);
                        const match = decodedUrl.match(/\/(\d+)$/);
                        if (match && match[1]) prsParaAnalisar.add(parseInt(match[1]));
                        else {
                            const parts = decodedUrl.split('/');
                            const lastPart = parts[parts.length - 1];
                            if (!isNaN(parseInt(lastPart))) prsParaAnalisar.add(parseInt(lastPart));
                        }
                    }
                });
            }
            if (prsParaAnalisar.size === 0) {
                console.error("Nenhum PR encontrado.");
                return;
            }
        }

        console.log(`\nObtendo requisitos do Card ${wiId}...`);
        const workItem = await workItemApi.getWorkItem(wiId);
        const title = workItem.fields['System.Title'];
        const description = workItem.fields['System.Description'] || '';
        const acceptanceCriteria = workItem.fields['Microsoft.VSTS.Common.AcceptanceCriteria'] || '';

        const requirementsText = `TÍTULO: ${title}\nDESCRIÇÃO: ${description}\nCRITÉRIOS: ${acceptanceCriteria}`;

        let codigoConsolidado = "";
        const listaPrs = Array.from(prsParaAnalisar);
        
        console.log(`\nColetando código de ${listaPrs.length} PRs...`);

        for (const prId of listaPrs) {
            const codigoPR = await extrairCodigoPR(gitApi, prId);
            codigoConsolidado += codigoPR;
        }

        if (!codigoConsolidado) {
            console.log("Nenhum código extraído. Abortando.");
            return;
        }

        console.log(`\nEnviando contexto consolidado (${codigoConsolidado.length} chars) para o Gemini...`);

        const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

        const prompt = `
        Você é um Tech Lead especialista em Code Review.
        
        CONTEXTO DO PROJETO (CARD/REQUISITOS):
        ${requirementsText}
        
        CÓDIGO FONTE (Pode conter múltiplos PRs que completam a tarefa juntos):
        ${codigoConsolidado}
        
        INSTRUÇÕES:
        1. Analise o conjunto COMPLETO de códigos. Às vezes o back-end está num PR e o front-end em outro.
        2. Verifique se a soma de todas as alterações atende à DESCRIÇÃO e CRITÉRIOS DE ACEITE.
        3. Ignore estilo e foque na REGRA DE NEGÓCIO.
        4. Ignore questões técnicas que não impactam a regra de negócio.
        5. Foque apenas na análise de conformidade com os requisitos.
        6. Liste os criterios atendidos e não atendidos. com um icone de ✔️ ou ❌.
        7. Seja sucinto, objetivo e claro.
        8. Responda de um modo que qualquer pessoa, técnica ou não, entenda e de forma resumida.
        9. Retorne apenas o texto da análise, sem saudações ou despedidas.
        10. Retorne no inicio do texto a situação final: "Aprovado ✔️" ou "Rejeitado ❌".
        `;

        const result = await model.generateContent(prompt);
        const analise = result.response.text();

        console.log("\nAtualizando o Card com a análise unificada...");
        
        const relatorioFinal = `
        <h2>🤖 Análise (${listaPrs.length} PRs)</h2>
        <p><strong>PRs Analisados:</strong> ${listaPrs.join(', ')}</p>
        <p><strong>Data:</strong> ${new Date().toLocaleString()}</p>
        <hr>
        ${analise.replace(/\n/g, '<br>')}
        `;
        
        const patchDocument = [
            {
                "op": "add",
                "path": "/fields/" + FIELD_UPDATE_ANALYSIS,
                "value": relatorioFinal
            }
        ];

        await workItemApi.updateWorkItem(null, patchDocument, wiId);
        console.log(`✅ Sucesso! Card ${wiId} atualizado com análise unificada.`);

    } catch (error) {
        console.error("Erro fatal:", error);
    }
}

main();