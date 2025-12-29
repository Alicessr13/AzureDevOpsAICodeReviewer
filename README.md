# 🤖 Azure DevOps AI Code Reviewer (Node.js)

Ferramenta CLI de automação que integra o **Azure DevOps** com o **Google Gemini AI** para realizar Code Reviews automáticos. O script analisa as alterações (diffs) dos Pull Requests, cruza com os Critérios de Aceite do Card (Work Item) vinculado e registra a análise diretamente no Azure DevOps.

## ✨ Funcionalidades

* **100% Configurável:** URL da organização e campos de destino são definidos via variáveis de ambiente.
* **Integração Bidirecional:** Lê do Azure Repos/Boards e escreve o feedback no Work Item.
* **Análise via IA (Gemini 2.5):** Valida se o código atende às regras de negócio e critérios de aceite.
* **Dois Modos de Operação:**
1. **Por PR:** Analisa um PR específico e atualiza o Card vinculado.
2. **Por Card:** Varre todas as relações do Card, identifica múltiplos PRs (usando Regex robusto para decodificar URLs) e gera um relatório consolidado.


* **Tratamento de Erros:** Ignora arquivos binários, deletados ou pastas, e corrige falhas comuns de IDs de links no Azure DevOps.

## 🛠️ Tecnologias

* Node.js (v18+)
* Azure DevOps Node API
* Google Generative AI SDK
* Dotenv (Gerenciamento de variáveis)

## 📋 Pré-requisitos

1. **Node.js** instalado.
2. **Conta no Azure DevOps** com permissão para ler repositórios e editar Work Items.
3. **Chave de API** do Google AI Studio.

## ⚙️ Configuração (.env)

O sistema agora é dinâmico. Crie um arquivo `.env` na raiz do projeto com as seguintes chaves:

```ini
# URL da sua organização no Azure DevOps
ORG_URL=https://dev.azure.com/SUA_ORGANIZACAO

# Seu Personal Access Token (PAT) com permissões (Code: Read, Work Items: Read & Write)
ADO_PAT=seu_token_pat_aqui

# Sua chave de API do Google Gemini
GOOGLE_API_KEY=sua_chave_gemini_aqui

# Nome INTERNO do campo no Card onde a análise será gravada
# Exemplo: System.History (para Discussão/Comentários) ou Custom.JustificativaDod
FIELD_UPDATE_ANALYSIS=Custom.JustificativaDod

```

> **Dica:** Para descobrir o nome interno de um campo customizado, você pode usar a API do Azure ou inspecionar o processo da organização. Campos customizados geralmente começam com `Custom.`.

## 🚀 Como Utilizar

### 1. Rodando via Código Fonte

Instale as dependências e execute:

```bash
npm install
node index.js

```

Siga o menu interativo:

* **Opção 1:** Digite o ID do PR. O script buscará o card pai automaticamente.
* **Opção 2:** Digite o ID do Card. O script buscará todos os PRs vinculados a ele na aba "Links".

### 2. Gerando Executável (.exe)

Para distribuir para a equipe sem necessidade de instalar Node.js:

1. Instale o `pkg`: `npm install -g pkg`
2. Compile:
```bash
pkg . --targets node18-win-x64 --output analisador-pr.exe

```


3. **Distribuição:** Entregue o arquivo `.exe` junto com o arquivo `.env` configurado na mesma pasta.

## 🧠 Detalhes da Lógica

* **Identificação de PRs:** O script utiliza `decodeURIComponent` e Expressões Regulares (`/\/(\d+)$/`) para extrair corretamente os IDs dos Pull Requests das URLs de relacionamento do Azure, evitando erros com links codificados ou artefatos incorretos.
* **Formatação:** O relatório é injetado no Azure DevOps em formato HTML para melhor legibilidade (quebras de linha, títulos em negrito).

## 🐛 Troubleshooting

* **Erro: "Project not found":** Verifique se a variável `ORG_URL` no `.env` está correta e sem barras extras no final.
* **Erro: "Field '...' does not exist":** Verifique se o nome em `FIELD_UPDATE_ANALYSIS` está exatamente igual ao "Reference Name" do campo no Azure DevOps.
* **Nenhum PR encontrado (Modo 2):** Certifique-se de que os PRs estão vinculados na aba "Links" ou "Relations" do Work Item e que o tipo do link é "Pull Request".

---
