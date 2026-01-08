const express = require('express');
const bodyParser = require('body-parser');
const azureDevOps = require('azure-devops-node-api');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const readline = require('readline');
require('dotenv').config();

// Configurações
const PORT = process.env.PORT || 3000;
const ORG_URL = process.env.ORG_URL;
const ADO_PAT = process.env.ADO_PAT;
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
const FIELD_UPDATE_ANALYSIS = process.env.FIELD_UPDATE_ANALYSIS;
const MODEL_NAME = process.env.MODEL_NAME || "gemini-2.5-flash";

const app = express();
app.use(bodyParser.json());

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

async function processarCard(ID) {
    console.log("Iniciando Validador de Requisitos (Modo Consolidado)...");

    if (!ADO_PAT || !GOOGLE_API_KEY) process.exit(1);

    try {
        const authHandler = azureDevOps.getPersonalAccessTokenHandler(ADO_PAT);
        const connection = new azureDevOps.WebApi(ORG_URL, authHandler);
        const gitApi = await connection.getGitApi();
        const workItemApi = await connection.getWorkItemTrackingApi();

        let prsParaAnalisar = new Set();
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
        const model = genAI.getGenerativeModel({ model: MODEL_NAME });

        const prompt = `
        Você é um Tech Lead especialista em Code Review.
        
        CONTEXTO DO PROJETO (CARD/REQUISITOS):
        ${requirementsText}
        
        CÓDIGO FONTE (Pode conter múltiplos PRs que completam a tarefa juntos):
        ${codigoConsolidado}
        
        INSTRUÇÕES DE ANÁLISE:
        1. Analise o conjunto COMPLETO de códigos. Às vezes o back-end está num PR e o front-end em outro.
        2. Verifique se a soma de todas as alterações atende à DESCRIÇÃO e CRITÉRIOS DE ACEITE.
        3. Ignore estilo e foque na REGRA DE NEGÓCIO.
        4. Ignore questões técnicas que não impactam a regra de negócio.
        5. Foque apenas na análise de conformidade com os requisitos.
        6. Liste os criterios atendidos e não atendidos. com um icone de ✔️ ou ❌.
        7. Seja sucinto, objetivo e claro.
        8. Responda de um modo que qualquer pessoa, técnica ou não, entenda e de forma resumida.
        9. Retorne apenas o texto da análise, sem saudações ou despedidas.
        10. Retorne no inicio do texto a situação final: "Aprovado ✔️" ou "Reprovado ❌".
        11. Caso o exame seja "Reprovado ❌", não retorne a palavra aprovado em nenhuma parte do texto.

        INSTRUÇÕES DE FORMATAÇÃO (HTML):
        1. Responda EXCLUSIVAMENTE em HTML válido. Não use Markdown (* ou **).
        2. Envolva a situação final ("Aprovado ✔️" ou "Reprovado ❌") em um <h3>.
        3. Use listas HTML <ul> e <li> para listar os critérios.
        4. Use <strong> para negrito.
        5. NÃO inclua tags <html>, <head> ou <body>, apenas o conteúdo interno.
        `;

        const result = await model.generateContent(prompt);
        const analise = result.response.text();

        console.log("\nAtualizando o Card com a análise unificada...");

        const relatorioFinal = `
        <div style="font-family: Segoe UI, sans-serif; margin-bottom: 15px;">
            <h3 style="margin-top: 0; margin-bottom: 5px; color: #2c3e50;">⚡️ Revisor de escopo ⚡️</h3>
            <p style="margin: 0; color: #555; font-size: 13px;">
                ➡️ Esta rotina analisa automaticamente o código dos Pull Requests vinculados para validar a aderência às <strong>Regras de Negócio</strong> e <strong>Critérios de Aceite</strong> do card.
            </p>
        </div>

        <div style="margin-bottom: 15px;">
            <h2>🤖 Resultado da Análise (${listaPrs.length} PRs)</h2>
            <p style="margin: 5px 0;"><strong>📂 PRs Analisados:</strong> ${listaPrs.join(', ')}</p>
            <p style="margin: 5px 0;"><strong>📅 Data da Análise:</strong> ${new Date().toLocaleString()}</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 15px 0;">

        <div style="font-size: 14px; line-height: 1.6;">
            ${analise.replace(/\n/g, '<br>')}
        </div>
        `;

        const isApproved = analise.includes("Aprovado ✔️");
        const CAMPO_STATUS = "Custom.CardAtulizado";

        let tagsRaw = (workItem.fields['System.Tags'] || "").split(';');

        // 2. Limpa espaços em branco nas pontas de cada tag
        let listaTags = tagsRaw.map(tag => tag.trim()).filter(t => t !== "");

        // DEBUG: Mostra exatamente o que o código está vendo (entre aspas para ver espaços)
        console.log("DEBUG - Tags lidas:", JSON.stringify(listaTags));

        if (isApproved) {
            // A. REMOÇÃO (BLINDADA)
            // Filtra removendo qualquer variação de "revisão de escopo" (maiúscula ou minúscula)
            const tamanhoAntes = listaTags.length;

            listaTags = listaTags.filter(tag => {
                return tag.toLowerCase() !== "revisão de escopo";
            });

            if (listaTags.length < tamanhoAntes) {
                console.log("DEBUG - Tag 'Revisão de escopo' removida com sucesso.");
            } else {
                console.log("DEBUG - A tag 'Revisão de escopo' não foi encontrada para remoção (verifique a grafia exata no log acima).");
            }

            // B. ADIÇÃO
            // Verifica se já tem "Em revisão" (também ignorando case)
            const jaTemTagNova = listaTags.some(tag => tag.toLowerCase() === "em revisão");

            if (!jaTemTagNova) {
                listaTags.push("Em revisão");
                console.log("DEBUG - Tag 'Em revisão' adicionada.");
            }
        }

        const patchDocument = [
            {
                "op": "add",
                "path": "/fields/" + FIELD_UPDATE_ANALYSIS,
                "value": relatorioFinal
            }
        ];

        if (isApproved) {
            // patchDocument.push({
            //     "op": "add",
            //     "path": "/fields/" + CAMPO_STATUS,
            //     "value": "Sim"
            // });
            patchDocument.push({
                "op": "replace",
                "path": "/fields/System.Tags",
                "value": listaTags.join('; ')
            });
        } else {
            if (workItem.fields && workItem.fields[CAMPO_STATUS]) {
                patchDocument.push({
                    "op": "remove",
                    "path": "/fields/" + CAMPO_STATUS
                });
            }
        }



        await workItemApi.updateWorkItem(null, patchDocument, wiId);
        console.log(`✅ Sucesso! Card ${wiId} atualizado com análise unificada.`);

    } catch (error) {
        console.error("Erro fatal:", error);
    }
}
app.post('/webhook', (req, res) => {
    // 1. Responde rápido
    res.status(200).send('Received');

    const body = req.body;
    
    console.log("\n⚡ ---------------------------------------------------");
    console.log("📦 WEBHOOK RECEBIDO - ANALISANDO ESTRUTURA:");
    
    // 2. IMPRIME TUDO PARA A GENTE ACHAR O ID CERTO
    // Isso vai mostrar o JSON inteiro no seu terminal
    console.log(JSON.stringify(body, null, 2)); 

    // 3. Tenta identificar o ID de várias formas possíveis
    let idCandidato = null;

    if (body.resource) {
        // Tenta pegar o ID direto (padrão)
        if (body.resource.id) {
            console.log(`🔎 body.resource.id encontrou: ${body.resource.id}`);
            idCandidato = body.resource.id;
        }
        
        // Tenta pegar workItemId (comum em alguns eventos)
        if (body.resource.workItemId) {
            console.log(`🔎 body.resource.workItemId encontrou: ${body.resource.workItemId}`);
            idCandidato = body.resource.workItemId;
        }

        // Tenta pegar de containers de revisão
        if (body.resource.revision && body.resource.revision.id) {
             console.log(`🔎 body.resource.revision.id encontrou: ${body.resource.revision.id}`);
        }
    }

    // 4. Se achou um ID, tenta processar
    if (idCandidato) {
        console.log(`🎯 Tentando processar o ID: ${idCandidato}`);
        processarCard(idCandidato);
    } else {
        console.log("❌ Não consegui encontrar nenhum ID válido neste pacote.");
    }
});

app.listen(PORT, () => {
    console.log(`👀 Servidor rodando na porta ${PORT}. Aguardando Webhooks...`);
});