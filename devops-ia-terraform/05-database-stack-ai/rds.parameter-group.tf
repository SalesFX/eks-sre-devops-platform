resource "aws_db_parameter_group" "this" {
  name        = "${var.project.name}-${var.project.environment}-postgres16"
  family      = "postgres16"
  description = "Parameter group for ${var.project.name} ${var.project.environment} enforcing SSL and tuning for db.t3.micro."

  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "immediate"
  }

  tags = {
    Component = "rds-parameter-group"
  }

  lifecycle {
    create_before_destroy = true
  }
}
