<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow">
  <title>Administração | Barber King</title>
  <link rel="icon" href="logo.svg">
  <link rel="stylesheet" href="style 3.css">
  <link rel="stylesheet" href="admin.css">
</head>
<body class="admin-page">
  <header class="admin-header">
    <a class="brand" href="index 6.html">
      <img src="logo.svg" alt="" width="40" height="40">BARBER KING
      <span>PAINEL ADMINISTRATIVO</span>
    </a>
    <a class="text-link" href="index 6.html">Voltar ao site</a>
  </header>
  <main class="admin-main">
    <section id="loginPanel" class="admin-panel login-panel" hidden>
      <p class="eyebrow">ACESSO RESTRITO</p>
      <h1>Entrar no painel</h1>
      <form id="loginForm">
        <label>Usuário<input name="username" autocomplete="username" required></label>
        <label>Senha<input name="password" type="password" autocomplete="current-password" required></label>
        <button class="btn" type="submit">Entrar</button>
      </form>
      <div id="loginNotice" role="status" aria-live="polite"></div>
    </section>
    <section id="dashboard" hidden>
      <div class="admin-toolbar">
        <div>
          <p class="eyebrow">BARBER KING / DADOS</p>
          <h1>Gerenciar registros</h1>
        </div>
        <button id="logoutButton" class="btn outline" type="button">Sair</button>
      </div>
      <div class="admin-panel">
        <label for="resourceSelect">Tabela</label>
        <div class="resource-controls">
          <select id="resourceSelect"></select>
          <button id="createButton" class="btn" type="button">Novo registro</button>
        </div>
        <div id="notice" role="status" aria-live="polite"></div>
        <div class="table-wrap">
          <table>
            <thead id="tableHead"></thead>
            <tbody id="tableBody"></tbody>
          </table>
        </div>
        <div class="pagination">
          <button id="previousPage" class="btn outline" type="button">Anterior</button>
          <span id="pageLabel"></span>
          <button id="nextPage" class="btn outline" type="button">Próxima</button>
        </div>
      </div>
    </section>
  </main>
  <dialog id="recordDialog" class="admin-dialog">
    <form id="recordForm">
      <div class="dialog-heading">
        <h2 id="dialogTitle"></h2>
        <button id="closeDialog" class="text-link" type="button" aria-label="Fechar">Fechar</button>
      </div>
      <div id="recordFields" class="record-fields"></div>
      <button class="btn" type="submit">Salvar</button>
    </form>
  </dialog>
  <script src="admin.js" defer></script>
</body>
</html>
