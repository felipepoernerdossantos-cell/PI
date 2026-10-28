(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;',
  })[char]);
  const money = value => Number(value).toLocaleString('pt-BR', {style:'currency',currency:'BRL'});
  const showToast = message => {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(window.dbToastTimer);
    window.dbToastTimer = setTimeout(() => toast.classList.remove('show'), 5000);
  };
  async function api(action, options = {}) {
    const response = await fetch(`api.php?action=${action}`, {
      credentials:'same-origin',
      ...options,
      headers:{...(options.body ? {'Content-Type':'application/json'} : {}),...(options.headers || {})},
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Erro da API (${response.status}).`);
    return result;
  }

  let catalog;
  let cart = [];
  try {
    const storedCart = JSON.parse(localStorage.getItem('bk-db-cart') || '[]');
    if (Array.isArray(storedCart)) {
      cart = storedCart.filter(item => Number.isInteger(item.product_id) && Number.isInteger(item.quantity) && item.quantity > 0);
    }
  } catch {
    showToast('Não foi possível recuperar a sacola salva neste navegador.');
  }
  function persistCart() {
    try {
      localStorage.setItem('bk-db-cart', JSON.stringify(cart));
    } catch {
      showToast('Não foi possível salvar a sacola neste navegador.');
    }
  }

  function renderCatalog(data) {
    catalog = data;
    $('#services').innerHTML = data.services.map((service,index) => `
      <article class="service">
        <div class="service-top"><span class="num">${String(index + 1).padStart(2,'0')}</span></div>
        <h3>${escapeHtml(service.nome)}</h3><p>${escapeHtml(service.descricao || '')}</p>
        <small>${service.duracao_minutos} minutos de cuidado</small>
        <div class="service-bottom"><b>${money(service.preco)}</b>
          <button data-service-id="${service.id}">Agendar ↗</button></div>
      </article>`).join('');
    $('#barbers').innerHTML = data.barbers.map(barber => `
      <article class="barber">
        <div class="portrait"><div class="db-portrait">${escapeHtml(barber.nome.split(/\s+/).map(part => part[0]).slice(0,2).join(''))}${barberPhoto(barber.foto) ? `<img loading="lazy" src="${escapeHtml(barberPhoto(barber.foto))}" alt="Foto de ${escapeHtml(barber.nome)}">` : ''}</div>
          <span>${Number(barber.anos_experiencia)} anos de experiência</span></div>
        <h3>${escapeHtml(barber.nome)}</h3><p>${escapeHtml(barber.especialidade)}</p>
        <button class="text-link" data-barber-id="${barber.id}">Agendar com ${escapeHtml(barber.nome.split(' ')[0])} ↗</button>
      </article>`).join('');
    $('#products').innerHTML = data.products.map(product => `
      <article class="product">
        <div class="product-img"><div class="db-product-mark"><img src="logo.svg" alt=""><span>${escapeHtml(product.categoria || 'Barber King')}</span></div></div>
        <h3>${escapeHtml(product.nome)}</h3><p>${escapeHtml(product.descricao || '')}</p>
        <div class="product-bottom"><b>${money(product.preco)}</b>
          <button data-product-id="${product.id}" aria-label="Adicionar ${escapeHtml(product.nome)} à sacola" ${Number(product.estoque) < 1 ? 'disabled' : ''}>+</button></div>
      </article>`).join('');
    const average = Number(data.reviewSummary.average);
    $('#ratingValue').textContent = average.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:1});
    const reviewCount = Number(data.reviewSummary.count);
    $('#reviewCount').textContent = `${reviewCount} ${reviewCount === 1 ? 'avaliação aprovada' : 'avaliações aprovadas'}.`;
    renderReviews(data.reviews);
    bindCatalogActions();
    renderCart();
  }

  function barberPhoto(value) {
    if (typeof value !== 'string') return '';
    if (/^photo-[a-z0-9-]+\.jpg$/i.test(value)) {
      return `https://images.unsplash.com/${value.replace(/\.jpg$/i,'')}?auto=format&fit=crop&w=600&q=80`;
    }
    if (/^https:\/\/images\.unsplash\.com\/[a-z0-9/_.-]+(?:\?[a-z0-9=&_.-]*)?$/i.test(value)) {
      return value;
    }
    return '';
  }

  function renderReviews(reviews) {
    const text = $('#quoteText');
    const name = $('#quoteName');
    const score = $('.quote > div span');
    const dots = $('#quoteDots');
    if (!reviews.length) {
      text.textContent = 'Ainda não há avaliações aprovadas.';
      name.textContent = '';
      score.textContent = '';
      dots.replaceChildren();
      return;
    }
    let index = 0;
    const show = () => {
      const review = reviews[index];
      text.textContent = review.comentario || 'Avaliação sem comentário.';
      name.textContent = review.nome_cliente;
      score.textContent = `${review.nota} de 5 estrelas`;
      dots.innerHTML = reviews.map((_,i) => `<button class="${i === index ? 'active' : ''}" aria-label="Mostrar avaliação ${i + 1}" data-review="${i}"></button>`).join('');
      $$('[data-review]',dots).forEach(button => button.onclick = () => {
        index = Number(button.dataset.review);
        show();
      });
    };
    show();
    if (reviews.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setInterval(() => {
        if (!document.hidden) {
          index = (index + 1) % reviews.length;
          show();
        }
      },6500);
    }
  }

  function bindCatalogActions() {
    $$('[data-book]').forEach(button => {
      button.disabled = false;
      button.onclick = () => startBooking();
    });
    $$('[data-service-id]').forEach(button => button.onclick = () => startBooking(Number(button.dataset.serviceId)));
    $$('[data-barber-id]').forEach(button => button.onclick = () => startBooking(null, Number(button.dataset.barberId)));
    $$('[data-product-id]').forEach(button => button.onclick = () => {
      const id = Number(button.dataset.productId);
      const line = cart.find(item => item.product_id === id);
      if (line) line.quantity++;
      else cart.push({product_id:id,quantity:1});
      persistCart();
      renderCart();
      showToast('Produto adicionado à sacola.');
    });
    $('#cartBtn').disabled = false;
  }

  function renderCart() {
    const products = new Map((catalog?.products || []).map(product => [Number(product.id),product]));
    cart = cart.filter(item => products.has(item.product_id));
    $('#cartCount').textContent = cart.reduce((sum,item) => sum + item.quantity,0);
    const lines = cart.map(item => ({...item,product:products.get(item.product_id)}));
    $('#cartBody').innerHTML = lines.length ? lines.map(item => `
      <div class="cart-row"><span>${escapeHtml(item.product.nome)} × ${item.quantity}</span>
      <b>${money(item.product.preco * item.quantity)}</b>
      <button data-remove-product="${item.product_id}" aria-label="Remover ${escapeHtml(item.product.nome)}">×</button></div>`).join('')
      + `<p>Total: ${money(lines.reduce((sum,item) => sum + Number(item.product.preco) * item.quantity,0))}</p>
      <button class="btn" id="checkout" type="button">Finalizar pedido ↗</button>`
      : '<p>Sua sacola está vazia. Escolha seu próximo cuidado.</p>';
    if (lines.length) $('#cartBody').insertAdjacentHTML('beforeend','<p><small>O pedido será registrado como aberto. Nenhuma cobrança online será realizada.</small></p>');
    $$('[data-remove-product]').forEach(button => button.onclick = () => {
      cart = cart.filter(item => item.product_id !== Number(button.dataset.removeProduct));
      persistCart();
      renderCart();
    });
    const checkout = $('#checkout');
    if (checkout) checkout.onclick = async () => {
      checkout.disabled = true;
      try {
        const result = await api('order', {method:'POST',body:JSON.stringify({items:cart})});
        cart = [];
        persistCart();
        renderCart();
        $('#cart').close();
        showToast(`Pedido #${result.id} registrado no banco. Total: ${money(result.total)}; sem cobrança online.`);
      } catch (error) {
        showToast(error.message);
      } finally {
        if (checkout.isConnected) checkout.disabled = false;
      }
    };
  }

  $('#cartBtn').onclick = () => catalog
    ? $('#cart').showModal()
    : showToast('Aguarde a conexão com o banco de dados.');

  $('#contactForm').onsubmit = async event => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const message = {
      nome:form.get('name'),telefone:form.get('phone'),email:form.get('email'),
      assunto:form.get('subject'),mensagem:form.get('message'),
    };
    try {
      await api('message', {method:'POST',body:JSON.stringify(message)});
      formElement.reset();
      showToast('Mensagem enviada com sucesso.');
    } catch (error) {
      showToast(error.message);
    }
  };

  const booking = {step:0,service:null,barber:null,date:'',time:'',name:'',phone:'',email:'',busy:[]};
  const today = () => {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  };
  const durationOf = () => Number(catalog.services.find(item => Number(item.id) === booking.service)?.duracao_minutos || 0);
  const startBooking = (serviceId = null, barberId = null) => {
    Object.assign(booking,{step:serviceId ? 1 : 0,service:serviceId,barber:barberId,date:'',time:'',name:'',phone:'',email:'',busy:[]});
    renderBooking();
    $('#booking').showModal();
  };

  function isAvailable(time) {
    const start = Number(time.slice(0,2)) * 60 + Number(time.slice(3,5));
    const finish = start + durationOf();
    const date = new Date(`${booking.date}T12:00:00`);
    const closing = date.getDay() === 6 ? 18 * 60 : 20 * 60;
    if (date.getDay() === 0 || start < 540 || finish > closing) return false;
    if (booking.date === today() && start <= new Date().getHours() * 60 + new Date().getMinutes()) return false;
    return !booking.busy.some(item => {
      const otherStart = Number(String(item.hora_agendamento).slice(0,2)) * 60 + Number(String(item.hora_agendamento).slice(3,5));
      return start < otherStart + Number(item.duracao_minutos) && finish > otherStart;
    });
  }

  function renderBooking() {
    const body = $('#bookingBody');
    const headings = ['Escolha seu serviço.','Escolha seu barbeiro.','Escolha a data.','Escolha seu horário.','Um pouco sobre você.','Confira sua reserva.'];
    let html = `<div class="step-count">PASSO ${booking.step + 1} DE 6 • AGENDAMENTO</div><h2>${headings[booking.step]}</h2>`;
    if (booking.step === 0) {
      html += `<div class="choices">${catalog.services.map(service => `<button class="choice ${booking.service === Number(service.id) ? 'selected' : ''}" data-choose-service="${service.id}">${escapeHtml(service.nome)}<small>${money(service.preco)} • ${service.duracao_minutos} min</small></button>`).join('')}</div>`;
    } else if (booking.step === 1) {
      html += `<div class="choices">${catalog.barbers.map(barber => `<button class="choice ${booking.barber === Number(barber.id) ? 'selected' : ''}" data-choose-barber="${barber.id}">${escapeHtml(barber.nome)}<small>${escapeHtml(barber.especialidade)}</small></button>`).join('')}</div>`;
    } else if (booking.step === 2) {
      html += `<label style="margin-top:25px">Data da visita<input id="bookingDate" type="date" min="${today()}" value="${booking.date}" required></label><p>Segunda a sexta: 09h às 20h. Sábado: 09h às 18h. Domingo: fechado.</p>`;
    } else if (booking.step === 3) {
      const times = [];
      for (let minute = 540; minute < 1200; minute += 30) times.push(`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`);
      html += `<p>${new Date(`${booking.date}T12:00:00`).toLocaleDateString('pt-BR',{weekday:'long',day:'2-digit',month:'long'})}</p><div class="choices">${times.map(time => `<button class="choice ${booking.time === time ? 'selected' : ''}" data-choose-time="${time}" ${isAvailable(time) ? '' : 'disabled'}>${time}${isAvailable(time) ? '' : ' • indisponível'}</button>`).join('')}</div><small>Os horários são verificados no banco de dados.</small>`;
    } else if (booking.step === 4) {
      html += `<form id="clientForm" style="margin-top:25px">
        <label>Nome<input name="name" required minlength="2" maxlength="120" autocomplete="name" value="${escapeHtml(booking.name)}"></label>
        <label>Telefone<input name="phone" type="tel" required pattern="[0-9()+ .-]{10,25}" autocomplete="tel" value="${escapeHtml(booking.phone)}"></label>
        <label>E-mail<input name="email" type="email" required maxlength="150" autocomplete="email" value="${escapeHtml(booking.email)}"></label></form>`;
    } else {
      const service = catalog.services.find(item => Number(item.id) === booking.service);
      const barber = catalog.barbers.find(item => Number(item.id) === booking.barber);
      html += `<div class="summary"><span>Serviço</span><b>${escapeHtml(service.nome)}</b><span>Barbeiro</span><b>${escapeHtml(barber.nome)}</b><span>Data</span><b>${booking.date}</b><span>Horário</span><b>${booking.time}</b><span>Duração</span><b>${service.duracao_minutos} minutos</b><span>Preço</span><b>${money(service.preco)}</b></div><p>Reserva para ${escapeHtml(booking.name)}</p><small>O agendamento será registrado no banco e o horário ficará reservado.</small>`;
    }
    html += `<div class="step-actions">${booking.step ? '<button class="btn outline" id="bookingPrevious" type="button">Voltar</button>' : ''}<button class="btn" id="bookingNext" type="button">${booking.step === 5 ? 'Confirmar agendamento' : 'Continuar ↗'}</button></div>`;
    body.innerHTML = html;
    $$('[data-choose-service]',body).forEach(button => button.onclick = () => {booking.service=Number(button.dataset.chooseService);renderBooking();});
    $$('[data-choose-barber]',body).forEach(button => button.onclick = () => {booking.barber=Number(button.dataset.chooseBarber);renderBooking();});
    $$('[data-choose-time]',body).forEach(button => button.onclick = () => {booking.time=button.dataset.chooseTime;renderBooking();});
    $('#bookingDate',body)?.addEventListener('change',event => {booking.date=event.target.value;});
    $('#bookingPrevious',body)?.addEventListener('click',() => {
      if (booking.step === 4) Object.assign(booking,Object.fromEntries(new FormData($('#clientForm',body))));
      booking.step--;
      renderBooking();
    });
    $('#bookingNext',body).onclick = async event => {
      if (booking.step === 0 && !booking.service) return showToast('Escolha um serviço.');
      if (booking.step === 1 && !booking.barber) return showToast('Escolha um barbeiro.');
      if (booking.step === 2) {
        const date = new Date(`${booking.date}T12:00:00`);
        if (!booking.date || booking.date < today() || date.getDay() === 0) return showToast('Escolha uma data de hoje em diante, de segunda a sábado.');
        try {
          const response = await api(`availability&date=${encodeURIComponent(booking.date)}&barber_id=${booking.barber}`);
          booking.busy = response.bookings;
          booking.step++;
          renderBooking();
        } catch (error) {
          showToast(error.message);
        }
        return;
      }
      if (booking.step === 3 && !booking.time) return showToast('Escolha um horário disponível.');
      if (booking.step === 4) {
        const form = $('#clientForm',body);
        if (!form.reportValidity()) return;
        Object.assign(booking,Object.fromEntries(new FormData(form)));
      }
      if (booking.step === 5) {
        event.currentTarget.disabled = true;
        try {
          const result = await api('booking',{method:'POST',body:JSON.stringify({
            name:booking.name,phone:booking.phone,email:booking.email,
            service_id:booking.service,barber_id:booking.barber,date:booking.date,time:booking.time,
          })});
          body.innerHTML = `<div class="success">✓</div><h2>Agendamento realizado<br><em>com sucesso!</em></h2><p>Reserva #${result.id} registrada.</p><p>${escapeHtml(booking.date)} às ${escapeHtml(booking.time)}.</p><div class="step-actions"><button class="btn" id="bookingDone" type="button">Concluir</button></div>`;
          $('#bookingDone').onclick = () => $('#booking').close();
        } catch (error) {
          showToast(error.message);
          event.currentTarget.disabled = false;
        }
        return;
      }
      booking.step++;
      renderBooking();
    };
  }

  async function initialize() {
    $('#services').textContent = 'Carregando serviços do banco de dados…';
    $('#barbers').textContent = 'Carregando barbeiros do banco de dados…';
    $('#products').textContent = 'Carregando produtos do banco de dados…';
    $$('[data-book]').forEach(button => { button.disabled = true; });
    $('#cartBtn').disabled = true;
    try {
      const data = await api('catalog');
      renderCatalog(data);
    } catch (error) {
      $('#services').textContent = 'Os serviços não puderam ser carregados.';
      $('#barbers').textContent = 'A equipe não pôde ser carregada.';
      $('#products').textContent = 'Os produtos não puderam ser carregados.';
      showToast(`Não foi possível carregar os dados do banco: ${error.message}`);
    }
  }

  initialize();
})();
