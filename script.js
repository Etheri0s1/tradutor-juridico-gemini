document.addEventListener('DOMContentLoaded', function() {
    const inputPdf = document.getElementById('input-pdf');
    const botaoAnalisar = document.getElementById('botao-analisar');
    const nomeArquivo = document.getElementById('nome-arquivo');
    const textoAnalise = document.getElementById('texto-analise');
    const alternarLeitura = document.getElementById('alternar-leitura');
    const alternarAudio = document.getElementById('alternar-audio');
    const areaUpload = document.querySelector('.area-upload');

    const sinteseVoz = window.speechSynthesis;
    let vozAtiva = false;

    if (typeof GEMINI_CONFIG === 'undefined' || !GEMINI_CONFIG.API_KEY || !GEMINI_CONFIG.API_ENDPOINT_BASE || !GEMINI_CONFIG.MODEL_NAME) {
        console.error("Erro Crítico: GEMINI_CONFIG não está definido corretamente em config.js ou falta API_KEY, API_ENDPOINT_BASE ou MODEL_NAME.");
        textoAnalise.textContent = "Erro de configuração da API. Verifique o console.";
        if (botaoAnalisar) botaoAnalisar.disabled = true;
        return;
    }

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        areaUpload.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    ['dragenter', 'dragover'].forEach(eventName => {
        areaUpload.addEventListener(eventName, highlight, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        areaUpload.addEventListener(eventName, unhighlight, false);
    });

    function highlight() {
        areaUpload.classList.add('highlight');
    }

    function unhighlight() {
        areaUpload.classList.remove('highlight');
    }

    areaUpload.addEventListener('drop', handleDrop, false);

    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            inputPdf.files = files;
            handleFiles(files);
        }
    }

    inputPdf.addEventListener('change', function() {
        if (this.files.length) {
            handleFiles(this.files);
        }
    });

    function handleFiles(files) {
        const arquivo = files[0];
        if (arquivo.type === 'application/pdf') {
            if (arquivo.size <= 25 * 1024 * 1024) {
                nomeArquivo.textContent = arquivo.name;
                botaoAnalisar.disabled = false;
            } else {
                alert('O arquivo é muito grande (máximo 25MB)');
                resetUpload();
            }
        } else {
            alert('Por favor, selecione um arquivo PDF');
            resetUpload();
        }
    }

    function resetUpload() {
        inputPdf.value = '';
        nomeArquivo.textContent = '';
        botaoAnalisar.disabled = true;
    }

    function lerTexto(texto) {
        if (vozAtiva) {
            sinteseVoz.cancel();
        }

        if (alternarAudio.checked) {
            const utterance = new SpeechSynthesisUtterance(texto);
            utterance.lang = 'pt-BR';
            utterance.rate = 0.9;


            const setVoice = () => {
                const voices = sinteseVoz.getVoices();
                const portugueseVoice = voices.find(voice => voice.lang.startsWith('pt')); // 'pt' ou 'pt-BR'
                if (portugueseVoice) {
                    utterance.voice = portugueseVoice;
                }
                sinteseVoz.speak(utterance);
                vozAtiva = true;
            };

            if (sinteseVoz.getVoices().length === 0) {
                sinteseVoz.addEventListener('voiceschanged', setVoice, { once: true });
            } else {
                setVoice();
            }

            utterance.onend = function() {
                vozAtiva = false;
            };
            utterance.onerror = function(event) {
                console.error('Erro na síntese de voz:', event.error);
                vozAtiva = false;
            };
        }
    }

    async function extrairTextoPDF(arquivo) {
        const arrayBuffer = await arquivo.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let textoCompleto = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const pagina = await pdf.getPage(i);
            const textoConteudo = await pagina.getTextContent();
            textoCompleto += textoConteudo.items.map(item => item.str).join(' ') + "\n";
        }
        return textoCompleto;
    }

    async function analisarComGemini(texto) {
        const fullApiUrl = `${GEMINI_CONFIG.API_ENDPOINT_BASE}${GEMINI_CONFIG.MODEL_NAME}:generateContent?key=${GEMINI_CONFIG.API_KEY}`;

        try {
            const response = await fetch(fullApiUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `EXPLIQUE ESTE DOCUMENTO JURÍDICO COMO SE FOSSE PARA UM AMIGO LEIGO:

REGRAS:
1. Use português simples, sem termos técnicos.
2. Quebre em tópicos curtos.
3. Destaque apenas o que é importante.
4. Use exemplos do dia a dia (ex: "multa" = "valor extra por atraso").
5. Não invente informações que não estão no texto.
6. Se o texto for muito curto ou não parecer um documento jurídico, diga que não pode analisá-lo adequadamente.

TEXTO PARA ANALISAR:
${texto}`
                        }]
                    }],
                })
            });

            if (!response.ok) {
                const errorBody = await response.text(); // Tenta ler como texto primeiro
                console.error(`Erro HTTP da API: ${response.status} ${response.statusText}`);
                console.error("Corpo da resposta do erro:", errorBody);
                let errorMessage = `Falha na requisição API (status ${response.status}).`;
                try {
                    const parsedError = JSON.parse(errorBody);
                    if (parsedError && parsedError.error && parsedError.error.message) {
                        errorMessage += ` Detalhes: ${parsedError.error.message}`;
                    } else {
                        errorMessage += ` Resposta do servidor: ${errorBody.substring(0, 200)}${errorBody.length > 200 ? "..." : ""}`;
                    }
                } catch (e) {
                    errorMessage += ` Resposta do servidor: ${errorBody.substring(0, 200)}${errorBody.length > 200 ? "..." : ""}`;
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();

            if (data && data.candidates && data.candidates.length > 0 &&
                data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts.length > 0) {
                return data.candidates[0].content.parts[0].text;
            } else {
                console.error("Estrutura de resposta inesperada da API:", data);
                let resultMessage = "Erro: A API retornou uma resposta com estrutura inesperada ou vazia.";
                if (data && data.candidates && data.candidates.length > 0 && data.candidates[0].finishReason) {
                    const reason = data.candidates[0].finishReason;
                    console.warn(`Geração finalizada com motivo: ${reason}`, data.candidates[0].safetyRatings);
                    if (reason === "SAFETY") {
                        resultMessage = "A resposta foi bloqueada por filtros de segurança. O documento pode conter conteúdo sensível ou o prompt precisa ser ajustado.";
                    } else if (reason === "MAX_TOKENS") {
                        resultMessage = "A resposta foi truncada porque excedeu o limite máximo de tokens. O documento pode ser muito longo para o modelo atual.";
                    } else if (reason === "OTHER" || reason === "UNSPECIFIED" || reason === "RECITATION") {
                        resultMessage = `A API respondeu, mas a geração não foi totalmente bem-sucedida (motivo: ${reason}). Tente novamente ou com um texto diferente.`;
                    }
                } else if (data && data.error && data.error.message) {
                    resultMessage = `Erro da API: ${data.error.message}`;
                }
                return resultMessage;
            }

        } catch (error) {
            console.error("Erro na função analisarComGemini:", error);

            return `Erro ao analisar: ${error.message || 'Verifique a conexão e tente novamente.'}`;
        }
    }

    botaoAnalisar.addEventListener('click', async function() {
        if (!inputPdf.files.length) return;

        botaoAnalisar.disabled = true;
        botaoAnalisar.innerHTML = '<span class="spinner-border spinner-border-sm" role="status" aria-hidden="true"></span> Analisando...';
        textoAnalise.textContent = "Extraindo texto do PDF e preparando para análise...";

        try {
            const textoPDF = await extrairTextoPDF(inputPdf.files[0]);

            if (!textoPDF || textoPDF.trim().length === 0) {
                textoAnalise.textContent = "Não foi possível extrair texto do PDF ou o PDF está vazio.";
                return;
            }
            if (textoPDF.length > 1000000) {
                alert("O texto extraído do PDF é excessivamente longo. A análise pode falhar ou ser lenta. Processando os primeiros 30.000 caracteres.");
            }


            textoAnalise.textContent = "Analisando com a IA...";
            const textoParaAnalise = textoPDF.slice(0, 30000);
            const resultado = await analisarComGemini(textoParaAnalise);

            textoAnalise.innerHTML = resultado.replace(/\n/g, '<br>');

            if (alternarAudio.checked && alternarLeitura.checked) {
                lerTexto(resultado);
            }

        } catch (error) {
            console.error("Erro no processamento da análise:", error);
            textoAnalise.textContent = `Erro no processo: ${error.message || "O documento pode estar corrompido ou houve um problema na comunicação."}`;
        } finally {
            botaoAnalisar.disabled = false;
            botaoAnalisar.textContent = 'Analisar Documento';
        }
    });

    alternarAudio.addEventListener('change', function() {
        const textoAtual = textoAnalise.textContent.trim();
        if (this.checked && alternarLeitura.checked && textoAtual && !textoAtual.startsWith("Aguardando") && !textoAtual.startsWith("Analisando") && !textoAtual.startsWith("Erro")) {
            lerTexto(textoAtual);
        } else if (vozAtiva) {
            sinteseVoz.cancel();
            vozAtiva = false;
        }
    });

    if (sinteseVoz.getVoices().length === 0) {
        sinteseVoz.addEventListener('voiceschanged', () => {});
    }
});