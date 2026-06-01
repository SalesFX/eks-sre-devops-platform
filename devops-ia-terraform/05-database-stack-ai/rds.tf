resource "aws_db_instance" "this" {
  identifier     = var.database.identifier
  engine         = "postgres"
  engine_version = var.database.engine_version
  instance_class = var.database.instance_class

  db_name  = var.database.db_name
  username = var.database.username

  # Master password managed by RDS via Secrets Manager; no static password in state or tfvars.
  manage_master_user_password = true

  allocated_storage = var.database.allocated_storage
  storage_type      = "gp3"
  storage_encrypted = true

  multi_az               = false
  publicly_accessible    = false
  db_subnet_group_name   = aws_db_subnet_group.this.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.this.name

  iam_database_authentication_enabled = true

  backup_retention_period = var.database.backup_retention_period
  backup_window           = var.database.backup_window
  maintenance_window      = var.database.maintenance_window

  auto_minor_version_upgrade = true
  deletion_protection        = var.database.deletion_protection
  skip_final_snapshot        = var.database.skip_final_snapshot
  final_snapshot_identifier  = "${var.database.identifier}-final-snapshot"

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = {
    Component = "rds-instance"
  }

}
