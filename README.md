# 🤖 Azure DevOps AI Business Validator (Node.js)

Ferramenta CLI de automação que integra o **Azure DevOps** com o **Google Gemini AI**. Diferente de linters ou analisadores estáticos comuns, **o foco desta ferramenta é a Regra de Negócio**.

O script cruza as alterações de código (Diffs) dos Pull Requests diretamente com a **Descrição** e os **Critérios de Aceite** do Work Item vinculado, validando a entrega funcional.

## 🎯 Filosofia de Análise

A IA foi configurada com um prompt específico para atuar como um **Tech Lead focado em Requisitos**.

* ✅ **O que ela analisa:**
* Aderência estrita aos Critérios de Aceite.
* Implementação da lógica descrita na regra de negócio.
* Se funcionalidades solicitadas no Card estão presentes no código.


* 🚫 **O que ela IGNORA:**
* Estilo de código (formatação, indentação, "code style").
* Questões puramente técnicas que não afetam o funcionamento ou a regra de negócio.



## ✨ Funcionalidades

* **100% Configurável:** URL da organização e campos de destino definidos via variáveis de ambiente (`.env`).
* **Integração Bidirecional:** Lê do Azure Repos/Boards e escreve o feedback no Work Item.
* **Relatório Objetivo:** O feedback indica claramente: **APROVADO** ou **REPROVADO**, listando objetivamente o que falta para atingir o "Definition of Done" (DoD).
* **Dois Modos de Operação:**
1. **Por PR:** Analisa um PR específico e atualiza o Card vinculado.
2. **Por Card:** Varre todas as relações do Card, identifica múltiplos PRs e gera um relatório consolidado.


* **Resiliência:** Tratamento robusto para ignorar arquivos binários, deletados e correção automática de URLs de links do Azure.

## 🛠️ Tecnologias

* Node.js (v18+)
* Azure DevOps Node API
* Google Generative AI SDK (Gemini 2.5)
* Dotenv

## 📋 Pré-requisitos

1. **Node.js** instalado.
2. **Conta no Azure DevOps** com permissão para ler repositórios e editar Work Items.
3. **Chave de API** do Google AI Studio.

## ⚙️ Configuração (.env)

Crie um arquivo `.env` na raiz do projeto (ou na mesma pasta do executável) com as chaves:

```ini
# URL da sua organização no Azure DevOps
ORG_URL=https://dev.azure.com/SUA_ORGANIZACAO

# Seu Personal Access Token (PAT)
# Permissões necessárias: Code (Read), Work Items (Read & Write)
ADO_PAT=seu_token_pat_aqui

# Sua chave de API do Google Gemini
GOOGLE_API_KEY=sua_chave_gemini_aqui

# Nome INTERNO do campo no Card onde a análise será gravada
# Exemplo: Custom.JustificativaDod ou System.History
FIELD_UPDATE_ANALYSIS=Custom.JustificativaDod

# Nome do modelo do gemini, se não for colocado um modelo espeficio utilizara o gemini-2.5-flash
MODEL_NAME="gemini-3-flash-preview"
```

## 🚀 Como Utilizar

### 1. Rodando via Código Fonte

```bash
npm install
node index.js

```

Siga o menu interativo:

* **Opção 1:** Digite o ID do PR. O script buscará o card pai automaticamente.
* **Opção 2:** Digite o ID do Card. O script buscará todos os PRs vinculados a ele na aba "Links".

### 2. Gerando Executável (.exe)

Para distribuir para a equipe (Product Owners, QAs ou Devs) sem necessidade de instalar Node.js:

1. Instale o `pkg`: `npm install -g pkg`
2. Compile:
```bash
pkg . --targets node18-win-x64 --output validador-req.exe

```


3. **Distribuição:** Entregue o arquivo `.exe` junto com o arquivo `.env` configurado.

## 🧠 Critérios da IA

O prompt enviado ao Gemini segue estritamente estas diretrizes:

1. Verificar se o código atende à **DESCRIÇÃO** e **CRITÉRIOS DE ACEITE**.
2. Ignorar estilo, focar na **REGRA DE NEGÓCIO**.
3. Ignorar questões técnicas que não impactam a regra.
4. Indicar se faltar algo (mesmo que possa estar em outro PR).
5. Veredito explícito: **APROVADO** ou **REPROVADO**.

## 🐛 Troubleshooting

* **Erro "Project not found":** Verifique a `ORG_URL` no `.env`.
* **Nenhum PR encontrado (Modo 2):** Certifique-se de que os PRs estão vinculados na aba "Links" ou "Relations" do Work Item e que o tipo do link é "Pull Request".
* **Erro no campo de destino:** Se o script der erro ao salvar no card, verifique se o nome em `FIELD_UPDATE_ANALYSIS` corresponde exatamente ao *Reference Name* do campo no Azure.
