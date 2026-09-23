data "aws_caller_identity" "me" {}

locals {
  # Immutable tag only, never a floating tag
  image = "${data.aws_caller_identity.me.account_id}.dkr.ecr.${var.region}.amazonaws.com/${var.ecr_repository_name}:${var.image_tag}"

  container_environment = [
    { name = "NODE_ENV", value = "production" },
    { name = "PORT", value = "3000" },
    { name = "DB_HOST", value = aws_db_instance.this.address },
    { name = "DB_PORT", value = "5432" },
    { name = "DB_NAME", value = "financial_control" },
    # RDS PostgreSQL 15+ enforces TLS; node-postgres reads PGSSLMODE when no ssl option is set.
    # "no-verify" encrypts without verifying the RDS certificate. Do not use "require", which
    # triggers full verification against a CA Node does not trust. Hardening later: RDS CA
    # bundle + verify-full.
    { name = "PGSSLMODE", value = "no-verify" },
    { name = "JWT_ACCESS_EXPIRES_IN", value = "15m" },
    { name = "JWT_REFRESH_EXPIRES_IN", value = "7d" },
    { name = "ALLOWED_ORIGINS", value = var.allowed_origins },
  ]

  # D-08, D-09: credentials only via secrets/valueFrom
  container_secrets = [
    { name = "DB_USER", valueFrom = "${aws_db_instance.this.master_user_secret[0].secret_arn}:username::" },
    { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.this.master_user_secret[0].secret_arn}:password::" },
    { name = "JWT_ACCESS_SECRET", valueFrom = data.aws_secretsmanager_secret.jwt.arn },
  ]
}

resource "aws_ecs_cluster" "this" {
  name = "financial-control"
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/financial-control-api"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "ecs_tasks_assume" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Execution role: what ECS itself uses (pull image, write logs, fetch secrets)
resource "aws_iam_role" "execution" {
  name               = "financial-control-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_iam_role_policy_attachment" "execution_managed" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Task role: empty, the app makes no AWS calls
resource "aws_iam_role" "task" {
  name               = "financial-control-ecs-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_tasks_assume.json
}

resource "aws_ecs_task_definition" "api" {
  family                   = "financial-control-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.task_cpu
  memory                   = var.task_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  # Container name "api" is the run-task override key used by the migration step (Plan 08-03)
  container_definitions = jsonencode([
    {
      name         = "api"
      image        = local.image
      essential    = true
      portMappings = [{ containerPort = 3000, protocol = "tcp" }]
      environment  = local.container_environment
      secrets      = local.container_secrets
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = var.region
          "awslogs-stream-prefix" = "api"
        }
      }
    }
  ])
}

# Phase 9 will register new task-definition revisions from CI and will then add
# `lifecycle { ignore_changes = [task_definition] }` on this service.
resource "aws_ecs_service" "api" {
  name                              = "financial-control-api"
  cluster                           = aws_ecs_cluster.this.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.desired_count
  launch_type                       = "FARGATE"
  platform_version                  = "LATEST"
  health_check_grace_period_seconds = 60
  wait_for_steady_state             = true

  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.task.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3000
  }

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  depends_on = [
    aws_lb_listener.http,
    aws_iam_role_policy.execution_secrets,
    aws_iam_role_policy_attachment.execution_managed,
    aws_route_table_association.private,
  ]
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.this.name
}

output "ecs_service_name" {
  value = aws_ecs_service.api.name
}

output "task_definition_family" {
  value = aws_ecs_task_definition.api.family
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.api.name
}
