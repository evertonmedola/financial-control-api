# D-09: JWT secret created by CLI outside Terraform; only metadata is read here
data "aws_secretsmanager_secret" "jwt" {
  name = var.jwt_secret_name
}

# D-08: execution role may read exactly these two secrets
data "aws_iam_policy_document" "execution_secrets" {
  statement {
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      data.aws_secretsmanager_secret.jwt.arn,
      aws_db_instance.this.master_user_secret[0].secret_arn,
    ]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  name   = "read-app-secrets"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}
