const tables = {
  agendamentos: { label:'Agendamentos', fields:[['cliente_id','Cliente ID','number'],['barbeiro_id','Barbeiro ID','number'],['servico_id','Serviço ID','number'],['data_agendamento','Data','date'],['hora_agendamento','Horário','time'],['status','Status','select',['agendado','confirmado','concluido','cancelado']],['observacoes','Observações','textarea',true]] },
  assinaturas: { label:'Assinaturas', fields:[['cliente_id','Cliente ID','number'],['plano','Plano','text'],['valor_mensal','Valor mensal','number'],['data_inicio','Data de início','date'],['status','Status','select',['ativa','pausada','cancelada']]] },
  avaliacoes: { label:'Avaliações', fields:[['cliente_id','Cliente ID (opcional)','number',false],['nome_cliente','Nome do cliente','text'],['nota','Nota (1 a 5)','number'],['comentario','Comentário','textarea',false],['aprovado','Aprovada','checkbox']] },
  barbeiros: { label:'Barbeiros', fields:[['nome','Nome','text'],['especialidade','Especialidade','text'],['anos_experiencia','Anos de experiência','number'],['foto','Foto/URL','text',false],['ativo','Ativo','checkbox']] },
  clientes: { label:'Clientes', fields:[['nome','Nome','text'],['telefone','Telefone','tel'],['email','E-mail','email']] },
  mensagens: { label:'Mensagens', fields:[['nome','Nome','text'],['telefone','Telefone','tel'],['email','E-mail','email'],['assunto','Assunto','select',['Informações','Barber Club','Produtos','Outros']],['mensagem','Mensagem','textarea'],['status','Status','select',['nova','lida','respondida']]] },
  pedidos: { label:'Pedidos', fields:[['cliente_id','Cliente ID (opcional)','number',false],['status','Status','select',['aberto','confirmado','finalizado','cancelado']],['valor_total','Valor total','number']] },
  pedido_itens: { label:'Itens de pedidos', fields:[['pedido_id','Pedido ID','number'],['produto_id','Produto ID','number'],['quantidade','Quantidade','number'],['preco_unitario','Preço unitário','number']] },
  produtos: { label:'Produtos', fields:[['nome','Nome','text'],['descricao','Descrição','text',false],['preco','Preço','number'],['estoque','Estoque','number'],['categoria','Categoria','text',false],['ativo','Ativo','checkbox']] },
  servicos: { label:'Serviços', fields:[['nome','Nome','text'],['descricao','Descrição','text',false],['preco','Preço','number'],['duracao_minutos','Duração em minutos','number'],['ativo','Ativo','checkbox']] },
};

const $ = (selector) => document.querySelector(selector);
const state = { csrf:'', resource:'agendamentos', page:1, pages:1, rows:[] };
const loginPanel = $('#loginPanel');
const dashboard = $('#dashboard');
const notice = $('#notice');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[char]);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials:'same-origin',
    ...options,
    headers:{
      ...(options.body ? {'Content-Type':'application/json'} : {}),
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Falha na API (${response.status}).`);
  return data;
}

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle('error', isError);
  const loginNotice = $('#loginNotice');
  if (loginNotice) {
    loginNotice.textContent = loginPanel.hidden ? '' : message;
    loginNotice.classList.toggle('error', isError);
  }
}

function renderFields(record = {}) {
  $('#recordFields').innerHTML = tables[state.resource].fields.map(([name,label,type,config]) => {
    const value = record[name] ?? '';
    const required = config !== false && type !== 'checkbox' ? 'required' : '';
    const wide = type === 'textarea' ? 'wide' : '';
    if (type === 'checkbox') {
      const checked = record[name] === undefined ? name === 'ativo' : Boolean(Number(value));
      return `<label class="checkbox-field ${wide}"><input name="${name}" type="checkbox" ${checked ? 'checked' : ''}>${label}</label>`;
    }
    if (type === 'select') {
      return `<label class="${wide}">${label}<select name="${name}" ${required}>${config.map(option => `<option value="${escapeHtml(option)}" ${String(value) === option ? 'selected' : ''}>${escapeHtml(option)}</option>`).join('')}</select></label>`;
    }
    if (type === 'textarea') {
      return `<label class="${wide}">${label}<textarea name="${name}" rows="4" ${required}>${escapeHtml(value)}</textarea></label>`;
    }
    const step = type === 'number' && ['preco','valor_mensal','valor_total','preco_unitario'].includes(name) ? '0.01' : type === 'number' ? '1' : undefined;
    return `<label class="${wide}">${label}<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${step ? `step="${step}"` : ''} ${type === 'number' ? 'min="0"' : ''} ${required}></label>`;
  }).join('');
}

function renderRows(data) {
  const config = tables[state.resource];
  const columns = ['id', ...config.fields.map(field => field[0])];
  $('#tableHead').innerHTML = `<tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join('')}<th>Ações</th></tr>`;
  $('#tableBody').innerHTML = data.data.length ? data.data.map((row,index) => `<tr>
    ${columns.map(column => `<td>${escapeHtml(row[column])}</td>`).join('')}
    <td><div class="row-actions"><button class="text-link" type="button" data-edit="${index}">Editar</button><button class="text-link" type="button" data-delete="${index}">Excluir</button></div></td>
  </tr>`).join('') : `<tr><td colspan="${columns.length + 1}">Nenhum registro encontrado.</td></tr>`;
  state.rows = data.data;
  state.pages = Math.max(1, Math.ceil(data.total / data.per_page));
  $('#pageLabel').textContent = `Página ${data.page} de ${state.pages} • ${data.total} registro(s)`;
  $('#previousPage').disabled = data.page <= 1;
  $('#nextPage').disabled = data.page >= state.pages;
  document.querySelectorAll('[data-edit]').forEach(button => button.onclick = () => openEditor(state.rows[Number(button.dataset.edit)]));
  document.querySelectorAll('[data-delete]').forEach(button => button.onclick = () => deleteRecord(state.rows[Number(button.dataset.delete)]));
}

async function loadRows() {
  showNotice('Carregando registros…');
  try {
    const data = await request(`api.php?resource=${encodeURIComponent(state.resource)}&page=${state.page}`);
    renderRows(data);
    showNotice('');
  } catch (error) {
    showNotice(error.message, true);
  }
}

function openEditor(record = null) {
  $('#dialogTitle').textContent = record ? `Editar ${tables[state.resource].label.toLowerCase()} #${record.id}` : `Novo ${tables[state.resource].label.toLowerCase()}`;
  renderFields(record || {});
  $('#recordDialog').showModal();
  $('#recordForm').dataset.id = record?.id ?? '';
}

async function deleteRecord(record) {
  if (!confirm(`Excluir o registro #${record.id}? Esta ação não pode ser desfeita.`)) return;
  try {
    await request(`api.php?resource=${encodeURIComponent(state.resource)}&id=${record.id}`, {
      method:'DELETE', headers:{'X-CSRF-Token':state.csrf},
    });
    showNotice('Registro excluído.');
    await loadRows();
  } catch (error) {
    showNotice(error.message, true);
  }
}

function showDashboard(authenticated) {
  loginPanel.hidden = authenticated;
  dashboard.hidden = !authenticated;
  if (authenticated) loadRows();
}

async function initialize() {
  try {
    const session = await request('api.php?action=session');
    state.csrf = session.csrf;
    showDashboard(session.authenticated);
  } catch (error) {
    loginPanel.hidden = false;
    showNotice(error.message, true);
  }
}

$('#resourceSelect').innerHTML = Object.entries(tables).map(([key,value]) => `<option value="${key}">${escapeHtml(value.label)}</option>`).join('');
$('#resourceSelect').value = state.resource;
$('#resourceSelect').onchange = () => {
  state.resource = $('#resourceSelect').value;
  state.page = 1;
  loadRows();
};
$('#createButton').onclick = () => openEditor();
$('#previousPage').onclick = () => { state.page--; loadRows(); };
$('#nextPage').onclick = () => { state.page++; loadRows(); };
$('#closeDialog').onclick = () => $('#recordDialog').close();
$('#recordDialog').addEventListener('click', event => {
  if (event.target === $('#recordDialog')) $('#recordDialog').close();
});

$('#loginForm').onsubmit = async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  try {
    const result = await request('api.php?action=session', {
      method:'POST',
      headers:{'X-CSRF-Token':state.csrf},
      body:JSON.stringify({username:form.get('username'),password:form.get('password')}),
    });
    state.csrf = result.csrf;
    event.currentTarget.reset();
    showDashboard(true);
  } catch (error) {
    showNotice(error.message, true);
  }
};

$('#logoutButton').onclick = async () => {
  try {
    const result = await request('api.php?action=session', {
      method:'POST',
      headers:{'X-CSRF-Token':state.csrf},
      body:JSON.stringify({operation:'logout'}),
    });
    state.csrf = result.csrf;
    showDashboard(false);
  } catch (error) {
    showNotice(error.message, true);
  }
};

$('#recordForm').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const record = {};
  for (const [name,,type] of tables[state.resource].fields) {
    const input = form.elements[name];
    record[name] = type === 'checkbox' ? Number(input.checked)
      : type === 'number' && input.value === '' ? null
      : input.value === '' ? null
      : type === 'number' ? Number(input.value)
      : input.value;
  }
  const id = form.dataset.id;
  try {
    await request(`api.php?resource=${encodeURIComponent(state.resource)}${id ? `&id=${encodeURIComponent(id)}` : ''}`, {
      method:id ? 'PUT' : 'POST',
      headers:{'X-CSRF-Token':state.csrf},
      body:JSON.stringify(record),
    });
    $('#recordDialog').close();
    showNotice(id ? 'Registro atualizado.' : 'Registro criado.');
    await loadRows();
  } catch (error) {
    showNotice(error.message, true);
  }
};

initialize();
