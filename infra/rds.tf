resource "aws_db_subnet_group" "this" {
  name       = "financial-control-db-subnets"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "financial-control-db-subnets" }
}

# D-07: PostgreSQL 16, single-AZ, private. No custom parameter group: the default
# keeps TLS enforcement ON (the app connects with PGSSLMODE=no-verify instead).
# D-08: RDS owns the master password in Secrets Manager; it never enters state.
resource "aws_db_instance" "this" {
  identifier     = "financial-control-db"
  engine         = "postgres"
  engine_version = "16"
  instance_class = "db.t4g.micro"

  allocated_storage = 20
  storage_type      = "gp3"
  storage_encrypted = true

  db_name                     = "financial_control"
  username                    = "financial_control"
  manage_master_user_password = true
  port                        = 5432

  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  # Free-tier account plan rejects >1 day (FreeTierRestrictionError); plan asked for 7
  backup_retention_period    = 1
  skip_final_snapshot        = true
  deletion_protection        = false
  auto_minor_version_upgrade = true
}

output "rds_endpoint" {
  value = aws_db_instance.this.address
}

output "rds_master_secret_arn" {
  value = aws_db_instance.this.master_user_secret[0].secret_arn
}
