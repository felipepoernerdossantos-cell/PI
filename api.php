<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

$secureCookie = isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off';
session_set_cookie_params([
    'httponly' => true,
    'secure' => $secureCookie,
    'samesite' => 'Strict',
]);
session_start();

function respond(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function body(): array
{
    $data = json_decode(file_get_contents('php://input'), true);
    if (!is_array($data)) {
        respond(400, ['error' => 'Envie um objeto JSON válido.']);
    }
    return $data;
}

function database(): PDO
{
    static $pdo;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $host = getenv('BK_DB_HOST') ?: '127.0.0.1';
    $name = getenv('BK_DB_NAME') ?: 'barber_king';
    $user = getenv('BK_DB_USER');
    $password = getenv('BK_DB_PASSWORD');
    if ($user === false || $password === false) {
        respond(503, ['error' => 'Configure BK_DB_USER e BK_DB_PASSWORD no ambiente do PHP.']);
    }

    $pdo = new PDO(
        "mysql:host={$host};dbname={$name};charset=utf8mb4",
        $user,
        $password,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
    return $pdo;
}

function requireAdmin(): void
{
    if (empty($_SESSION['admin'])) {
        respond(401, ['error' => 'Faça login para acessar esta operação.']);
    }
}

function requireCsrf(): void
{
    $token = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $token)) {
        respond(403, ['error' => 'Sessão expirada. Atualize a página e tente novamente.']);
    }
}

function positiveInt(mixed $value, string $label): int
{
    if (!is_int($value) && !is_string($value)) {
        respond(422, ['error' => "{$label} inválido."]);
    }
    $parsed = filter_var($value, FILTER_VALIDATE_INT);
    if ($parsed === false || $parsed < 1) {
        respond(422, ['error' => "{$label} inválido."]);
    }
    return $parsed;
}

function textValue(mixed $value, string $label, int $max, bool $required = true): ?string
{
    if ($value === null && !$required) {
        return null;
    }
    if (!is_string($value) && !is_numeric($value)) {
        respond(422, ['error' => "{$label} inválido."]);
    }
    $value = trim((string) $value);
    if ($required && $value === '') {
        respond(422, ['error' => "{$label} é obrigatório."]);
    }
    preg_match_all('/./us', $value, $characters);
    if (count($characters[0]) > $max) {
        respond(422, ['error' => "{$label} excede o limite de {$max} caracteres."]);
    }
    return $value === '' ? null : $value;
}

$fields = [
    'agendamentos' => ['cliente_id'=>'int','barbeiro_id'=>'int','servico_id'=>'int','data_agendamento'=>'date','hora_agendamento'=>'time','status'=>['agendado','confirmado','concluido','cancelado'],'observacoes'=>'text?'],
    'assinaturas' => ['cliente_id'=>'int','plano'=>'text:100','valor_mensal'=>'decimal','data_inicio'=>'date','status'=>['ativa','pausada','cancelada']],
    'avaliacoes' => ['cliente_id'=>'int?','nome_cliente'=>'text:120','nota'=>'rating','comentario'=>'text?:700','aprovado'=>'bool'],
    'barbeiros' => ['nome'=>'text:120','especialidade'=>'text:150','anos_experiencia'=>'uint','foto'=>'text?:255','ativo'=>'bool'],
    'clientes' => ['nome'=>'text:120','telefone'=>'text:25','email'=>'email:150'],
    'mensagens' => ['nome'=>'text:120','telefone'=>'text:25','email'=>'email:150','assunto'=>['Informações','Barber Club','Produtos','Outros'],'mensagem'=>'text:65535','status'=>['nova','lida','respondida']],
    'pedidos' => ['cliente_id'=>'int?','status'=>['aberto','confirmado','finalizado','cancelado'],'valor_total'=>'decimal'],
    'pedido_itens' => ['pedido_id'=>'int','produto_id'=>'int','quantidade'=>'uint','preco_unitario'=>'decimal'],
    'produtos' => ['nome'=>'text:120','descricao'=>'text?:255','preco'=>'decimal','estoque'=>'uint','categoria'=>'text?:80','ativo'=>'bool'],
    'servicos' => ['nome'=>'text:120','descricao'=>'text?:255','preco'=>'decimal','duracao_minutos'=>'uint','ativo'=>'bool'],
];
$requiredFields = [
    'agendamentos'=>['cliente_id','barbeiro_id','servico_id','data_agendamento','hora_agendamento'],
    'assinaturas'=>['cliente_id','data_inicio'],
    'avaliacoes'=>['nome_cliente','nota'],
    'barbeiros'=>['nome','especialidade'],
    'clientes'=>['nome','telefone','email'],
    'mensagens'=>['nome','telefone','email','assunto','mensagem'],
    'pedidos'=>[],
    'pedido_itens'=>['pedido_id','produto_id','quantidade','preco_unitario'],
    'produtos'=>['nome','preco'],
    'servicos'=>['nome','preco','duracao_minutos'],
];

function requireFields(array $input, array $required): void
{
    foreach ($required as $field) {
        if (!array_key_exists($field, $input) || $input[$field] === null || $input[$field] === '') {
            respond(422, ['error' => "O campo {$field} é obrigatório."]);
        }
    }
}

function cleanFields(array $input, array $schema): array
{
    $clean = [];
    foreach ($input as $key => $value) {
        if (!is_string($key) || !array_key_exists($key, $schema)) {
            respond(422, ['error' => 'Campo não permitido: ' . (string) $key]);
        }
        $rule = $schema[$key];
        if (is_array($rule)) {
            if (!in_array($value, $rule, true)) {
                respond(422, ['error' => "Valor inválido para {$key}."]);
            }
            $clean[$key] = $value;
        } elseif (in_array($rule, ['int', 'int?'], true)) {
            $clean[$key] = ($rule === 'int?' && ($value === null || $value === ''))
                ? null : positiveInt($value, $key);
        } elseif ($rule === 'uint') {
            $number = filter_var($value, FILTER_VALIDATE_INT);
            if ($number === false || $number < 0) {
                respond(422, ['error' => "{$key} deve ser um número inteiro não negativo."]);
            }
            $clean[$key] = $number;
        } elseif ($rule === 'bool') {
            if (!in_array($value, [0, 1, '0', '1', true, false], true)) {
                respond(422, ['error' => "{$key} inválido."]);
            }
            $clean[$key] = (int) (bool) $value;
        } elseif ($rule === 'decimal') {
            if (!is_numeric($value) || (float) $value < 0 || !is_finite((float) $value)) {
                respond(422, ['error' => "{$key} deve ser um valor numérico não negativo."]);
            }
            $clean[$key] = number_format((float) $value, 2, '.', '');
        } elseif ($rule === 'rating') {
            if (filter_var($value, FILTER_VALIDATE_INT) === false || (int) $value < 1 || (int) $value > 5) {
                respond(422, ['error' => 'A nota deve estar entre 1 e 5.']);
            }
            $clean[$key] = (int) $value;
        } elseif (str_starts_with($rule, 'date')) {
            if (!is_string($value)) {
                respond(422, ['error' => "Data inválida para {$key}."]);
            }
            $date = DateTime::createFromFormat('!Y-m-d', (string) $value);
            if (!$date || $date->format('Y-m-d') !== $value) {
                respond(422, ['error' => "Data inválida para {$key}."]);
            }
            $clean[$key] = $value;
        } elseif (str_starts_with($rule, 'time')) {
            if (!is_string($value) || !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/', $value)) {
                respond(422, ['error' => "Horário inválido para {$key}."]);
            }
            $clean[$key] = strlen($value) === 5 ? $value . ':00' : $value;
        } else {
            $optional = str_contains($rule, '?');
            $parts = explode(':', str_replace('?', '', $rule), 2);
            $max = isset($parts[1]) ? (int) $parts[1] : (int) $parts[0];
            $type = $parts[0];
            $text = textValue($value, $key, $max, !$optional);
            if ($type === 'email' && $text !== null && !filter_var($text, FILTER_VALIDATE_EMAIL)) {
                respond(422, ['error' => "E-mail inválido em {$key}."]);
            }
            $clean[$key] = $text;
        }
    }
    return $clean;
}

function availability(PDO $pdo, int $barberId, string $date, int $duration, string $time): bool
{
    $day = DateTime::createFromFormat('!Y-m-d', $date);
    if (!$day || $day->format('Y-m-d') !== $date || (int) $day->format('N') === 7 || $date < date('Y-m-d')) {
        return false;
    }
    $start = strtotime($date . ' ' . $time);
    $startMinute = (int) date('G', $start) * 60 + (int) date('i', $start);
    $endMinute = $startMinute + $duration;
    $closingMinute = (int) $day->format('N') === 6 ? 18 * 60 : 20 * 60;
    if ($startMinute < 9 * 60 || $endMinute > $closingMinute || ($date === date('Y-m-d') && $start <= time())) {
        return false;
    }
    $query = $pdo->prepare(
        "SELECT a.hora_agendamento, s.duracao_minutos
         FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
         WHERE a.barbeiro_id = ? AND a.data_agendamento = ? AND a.status <> 'cancelado'"
    );
    $query->execute([$barberId, $date]);
    foreach ($query->fetchAll() as $booking) {
        $otherStart = (int) date('G', strtotime($booking['hora_agendamento'])) * 60
            + (int) date('i', strtotime($booking['hora_agendamento']));
        if ($startMinute < $otherStart + (int) $booking['duracao_minutos']
            && $endMinute > $otherStart) {
            return false;
        }
    }
    return true;
}

try {
    $pdo = database();
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $action = $_GET['action'] ?? '';

    if ($action === 'session') {
        if ($method === 'GET') {
            if (empty($_SESSION['csrf'])) {
                $_SESSION['csrf'] = bin2hex(random_bytes(32));
            }
            respond(200, ['authenticated' => !empty($_SESSION['admin']), 'csrf' => $_SESSION['csrf']]);
        }
        if ($method !== 'POST') {
            respond(405, ['error' => 'Método não permitido.']);
        }
        requireCsrf();
        $input = body();
        if (($input['operation'] ?? '') === 'logout') {
            $_SESSION = [];
            session_regenerate_id(true);
            $_SESSION['csrf'] = bin2hex(random_bytes(32));
            respond(200, ['authenticated' => false, 'csrf' => $_SESSION['csrf']]);
        }
        $adminUser = getenv('BK_ADMIN_USER');
        $adminPassword = getenv('BK_ADMIN_PASSWORD');
        if ($adminUser === false || $adminPassword === false || $adminPassword === '') {
            respond(503, ['error' => 'Configure BK_ADMIN_USER e BK_ADMIN_PASSWORD no ambiente do PHP.']);
        }
        if (!is_string($input['username'] ?? null) || !is_string($input['password'] ?? null)
            || !hash_equals($adminUser, $input['username']) || !hash_equals($adminPassword, $input['password'])) {
            usleep(250000);
            respond(401, ['error' => 'Usuário ou senha inválidos.']);
        }
        session_regenerate_id(true);
        $_SESSION['admin'] = true;
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
        respond(200, ['authenticated' => true, 'csrf' => $_SESSION['csrf']]);
    }

    if (($action === 'catalog') && $method === 'GET') {
        $services = $pdo->query('SELECT id,nome,descricao,preco,duracao_minutos FROM servicos WHERE ativo = 1 ORDER BY id')->fetchAll();
        $barbers = $pdo->query('SELECT id,nome,especialidade,anos_experiencia,foto FROM barbeiros WHERE ativo = 1 ORDER BY id')->fetchAll();
        $products = $pdo->query('SELECT id,nome,descricao,preco,estoque,categoria FROM produtos WHERE ativo = 1 ORDER BY id')->fetchAll();
        $reviews = $pdo->query('SELECT nome_cliente,nota,comentario FROM avaliacoes WHERE aprovado = 1 ORDER BY id DESC LIMIT 20')->fetchAll();
        $reviewSummary = $pdo->query(
            'SELECT COALESCE(ROUND(AVG(nota),1),0) AS average, COUNT(*) AS count
             FROM avaliacoes WHERE aprovado = 1'
        )->fetch();
        respond(200, [
            'services'=>$services,
            'barbers'=>$barbers,
            'products'=>$products,
            'reviews'=>$reviews,
            'reviewSummary'=>$reviewSummary,
        ]);
    }

    if ($action === 'availability' && $method === 'GET') {
        $date = $_GET['date'] ?? '';
        $barberId = positiveInt($_GET['barber_id'] ?? null, 'barbeiro_id');
        if (!is_string($date)) {
            respond(422, ['error' => 'Data inválida.']);
        }
        $day = DateTime::createFromFormat('!Y-m-d', (string) $date);
        if (!$day || $day->format('Y-m-d') !== $date) {
            respond(422, ['error' => 'Data inválida.']);
        }
        $query = $pdo->prepare(
            "SELECT a.hora_agendamento, s.duracao_minutos
             FROM agendamentos a JOIN servicos s ON s.id = a.servico_id
             WHERE a.barbeiro_id = ? AND a.data_agendamento = ? AND a.status <> 'cancelado'"
        );
        $query->execute([$barberId, $date]);
        respond(200, ['bookings'=>$query->fetchAll()]);
    }

    if ($action === 'booking' && $method === 'POST') {
        $input = body();
        $name = textValue($input['name'] ?? null, 'Nome', 120);
        $phone = textValue($input['phone'] ?? null, 'Telefone', 25);
        $email = textValue($input['email'] ?? null, 'E-mail', 150);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            respond(422, ['error' => 'E-mail inválido.']);
        }
        if (!preg_match('/^[0-9()+ .-]{10,25}$/', $phone)) {
            respond(422, ['error' => 'Telefone inválido.']);
        }
        $barberId = positiveInt($input['barber_id'] ?? null, 'Barbeiro');
        $serviceId = positiveInt($input['service_id'] ?? null, 'Serviço');
        $date = textValue($input['date'] ?? null, 'Data', 10);
        $time = textValue($input['time'] ?? null, 'Horário', 8);
        if (!preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $time)) {
            respond(422, ['error' => 'Horário inválido.']);
        }
        $notes = textValue($input['notes'] ?? '', 'Observações', 500, false);
        $pdo->beginTransaction();
        $lock = $pdo->prepare('SELECT id FROM barbeiros WHERE id = ? AND ativo = 1 FOR UPDATE');
        $lock->execute([$barberId]);
        if (!$lock->fetch()) {
            $pdo->rollBack();
            respond(422, ['error' => 'Barbeiro indisponível.']);
        }
        $serviceQuery = $pdo->prepare('SELECT id,duracao_minutos FROM servicos WHERE id = ? AND ativo = 1');
        $serviceQuery->execute([$serviceId]);
        $service = $serviceQuery->fetch();
        if (!$service || !availability($pdo, $barberId, $date, (int) $service['duracao_minutos'], $time)) {
            $pdo->rollBack();
            respond(409, ['error' => 'Horário indisponível. Escolha outro horário.']);
        }
        $clientQuery = $pdo->prepare(
            'INSERT INTO clientes (nome,telefone,email) VALUES (?,?,?)
             ON DUPLICATE KEY UPDATE nome=VALUES(nome), telefone=VALUES(telefone), id=LAST_INSERT_ID(id)'
        );
        $clientQuery->execute([$name, $phone, $email]);
        $clientId = (int) $pdo->lastInsertId();
        if (!$clientId) {
            $findClient = $pdo->prepare('SELECT id FROM clientes WHERE email = ?');
            $findClient->execute([$email]);
            $clientId = (int) $findClient->fetchColumn();
        }
        $insert = $pdo->prepare(
            "INSERT INTO agendamentos (cliente_id,barbeiro_id,servico_id,data_agendamento,hora_agendamento,observacoes)
             VALUES (?,?,?,?,?,?)"
        );
        $insert->execute([$clientId,$barberId,$serviceId,$date,$time,$notes]);
        $id = (int) $pdo->lastInsertId();
        $pdo->commit();
        respond(201, ['id'=>$id,'message'=>'Agendamento registrado com sucesso.']);
    }

    if ($action === 'message' && $method === 'POST') {
        $input = body();
        $input['assunto'] = $input['assunto'] ?? 'Informações';
        requireFields($input, ['nome','telefone','email','assunto','mensagem']);
        $clean = cleanFields($input, $GLOBALS['fields']['mensagens']);
        $stmt = $pdo->prepare('INSERT INTO mensagens (nome,telefone,email,assunto,mensagem) VALUES (?,?,?,?,?)');
        $stmt->execute([$clean['nome'],$clean['telefone'],$clean['email'],$clean['assunto'],$clean['mensagem']]);
        respond(201, ['id'=>(int)$pdo->lastInsertId(),'message'=>'Mensagem enviada com sucesso.']);
    }

    if ($action === 'order' && $method === 'POST') {
        $input = body();
        if (!is_array($input['items'] ?? null) || count($input['items']) < 1 || count($input['items']) > 50) {
            respond(422, ['error' => 'O pedido precisa conter entre 1 e 50 itens.']);
        }
        $pdo->beginTransaction();
        $itemsByProduct = [];
        foreach ($input['items'] as $item) {
            if (!is_array($item)) {
                $pdo->rollBack();
                respond(422, ['error'=>'Item de pedido inválido.']);
            }
            $productId = positiveInt($item['product_id'] ?? null, 'Produto');
            $quantity = positiveInt($item['quantity'] ?? null, 'Quantidade');
            $itemsByProduct[$productId] = ($itemsByProduct[$productId] ?? 0) + $quantity;
            if ($itemsByProduct[$productId] > 1000) {
                $pdo->rollBack();
                respond(422, ['error'=>'A quantidade por produto excede o limite permitido.']);
            }
        }
        ksort($itemsByProduct);
        $items = [];
        $total = 0.0;
        foreach ($itemsByProduct as $productId => $quantity) {
            $productQuery = $pdo->prepare('SELECT id,nome,preco,estoque FROM produtos WHERE id = ? AND ativo = 1 FOR UPDATE');
            $productQuery->execute([$productId]);
            $product = $productQuery->fetch();
            if (!$product || (int)$product['estoque'] < $quantity) {
                $pdo->rollBack();
                respond(409, ['error' => 'Produto indisponível ou estoque insuficiente.']);
            }
            $items[] = ['id'=>$productId,'quantity'=>$quantity,'price'=>(float)$product['preco']];
            $total += (float)$product['preco'] * $quantity;
        }
        $insertOrder = $pdo->prepare("INSERT INTO pedidos (status,valor_total) VALUES ('aberto',?)");
        $insertOrder->execute([number_format($total,2,'.','')]);
        $orderId = (int)$pdo->lastInsertId();
        $insertItem = $pdo->prepare('INSERT INTO pedido_itens (pedido_id,produto_id,quantidade,preco_unitario) VALUES (?,?,?,?)');
        $updateStock = $pdo->prepare('UPDATE produtos SET estoque = estoque - ? WHERE id = ?');
        foreach ($items as $item) {
            $insertItem->execute([$orderId,$item['id'],$item['quantity'],number_format($item['price'],2,'.','')]);
            $updateStock->execute([$item['quantity'],$item['id']]);
        }
        $pdo->commit();
        respond(201, ['id'=>$orderId,'total'=>number_format($total,2,'.',''),'message'=>'Pedido registrado com sucesso.']);
    }

    $resource = $_GET['resource'] ?? '';
    if (!is_string($resource) || !array_key_exists($resource, $fields)) {
        respond(404, ['error' => 'Recurso não encontrado.']);
    }
    requireAdmin();
    $schema = $fields[$resource];
    $id = isset($_GET['id']) ? positiveInt($_GET['id'], 'ID') : null;

    if ($method === 'GET') {
        $page = max(1, (int) ($_GET['page'] ?? 1));
        $perPage = min(100, max(1, (int) ($_GET['per_page'] ?? 25)));
        if ($id !== null) {
            $stmt = $pdo->prepare("SELECT * FROM `{$resource}` WHERE id = ?");
            $stmt->execute([$id]);
            $row = $stmt->fetch();
            $row ? respond(200, ['data'=>$row]) : respond(404, ['error'=>'Registro não encontrado.']);
        }
        $total = (int) $pdo->query("SELECT COUNT(*) FROM `{$resource}`")->fetchColumn();
        $stmt = $pdo->prepare("SELECT * FROM `{$resource}` ORDER BY id DESC LIMIT :limit OFFSET :offset");
        $stmt->bindValue(':limit', $perPage, PDO::PARAM_INT);
        $stmt->bindValue(':offset', ($page - 1) * $perPage, PDO::PARAM_INT);
        $stmt->execute();
        respond(200, ['data'=>$stmt->fetchAll(),'total'=>$total,'page'=>$page,'per_page'=>$perPage]);
    }

    requireCsrf();
    if ($method === 'POST') {
        $input = body();
        requireFields($input, $requiredFields[$resource]);
        $clean = cleanFields($input, $schema);
        if (!$clean) {
            respond(422, ['error'=>'Informe os campos do registro.']);
        }
        $columns = array_keys($clean);
        $sql = 'INSERT INTO `' . $resource . '` (`' . implode('`,`', $columns) . '`) VALUES ('
            . implode(',', array_fill(0, count($columns), '?')) . ')';
        $stmt = $pdo->prepare($sql);
        $stmt->execute(array_values($clean));
        respond(201, ['id'=>(int)$pdo->lastInsertId(),'message'=>'Registro criado.']);
    }
    if ($method === 'PUT') {
        if ($id === null) {
            respond(400, ['error'=>'Informe o ID do registro.']);
        }
        $clean = cleanFields(body(), $schema);
        if (!$clean) {
            respond(422, ['error'=>'Informe ao menos um campo para atualizar.']);
        }
        $set = implode(',', array_map(static fn($column) => "`{$column}` = ?", array_keys($clean)));
        $stmt = $pdo->prepare("UPDATE `{$resource}` SET {$set} WHERE id = ?");
        $stmt->execute([...array_values($clean),$id]);
        $check = $pdo->prepare("SELECT id FROM `{$resource}` WHERE id = ?");
        $check->execute([$id]);
        if (!$check->fetch()) {
            respond(404, ['error'=>'Registro não encontrado.']);
        }
        respond(200, ['message'=>'Registro atualizado.']);
    }
    if ($method === 'DELETE') {
        if ($id === null) {
            respond(400, ['error'=>'Informe o ID do registro.']);
        }
        $stmt = $pdo->prepare("DELETE FROM `{$resource}` WHERE id = ?");
        $stmt->execute([$id]);
        if (!$stmt->rowCount()) {
            respond(404, ['error'=>'Registro não encontrado.']);
        }
        respond(200, ['message'=>'Registro excluído.']);
    }

    header('Allow: GET, POST, PUT, DELETE');
    respond(405, ['error'=>'Método não permitido.']);
} catch (PDOException $exception) {
    if (isset($pdo) && $pdo instanceof PDO && $pdo->inTransaction()) {
        $pdo->rollBack();
    }
    error_log('Barber King API database error: ' . $exception->getMessage());
    if ((string) $exception->getCode() === '23000') {
        respond(409, ['error'=>'A operação não pode ser concluída porque existem registros relacionados ou dados duplicados.']);
    }
    respond(500, ['error'=>'Falha ao acessar o banco de dados. Confira a conexão, as tabelas e as relações.']);
} catch (Throwable $exception) {
    error_log('Barber King API error: ' . $exception->getMessage());
    respond(500, ['error'=>'Erro interno da API. Consulte o log do PHP.']);
}
