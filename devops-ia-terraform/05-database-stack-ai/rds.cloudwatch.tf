resource "aws_cloudwatch_metric_alarm" "rds_connections_high" {
  alarm_name          = "${var.project.name}-${var.project.environment}-rds-connections-high"
  alarm_description   = "RDS DatabaseConnections above 80. db.t3.micro supports ~87 max connections."
  namespace           = "AWS/RDS"
  metric_name         = "DatabaseConnections"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  tags = {
    Component = "rds-monitoring"
    ADR       = "ADR-0017"
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_storage_low" {
  alarm_name          = "${var.project.name}-${var.project.environment}-rds-storage-low"
  alarm_description   = "RDS FreeStorageSpace below 5 GB. Writes will fail if storage is exhausted."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 5368709120
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  tags = {
    Component = "rds-monitoring"
    ADR       = "ADR-0017"
  }
}

resource "aws_cloudwatch_metric_alarm" "rds_memory_low" {
  alarm_name          = "${var.project.name}-${var.project.environment}-rds-memory-low"
  alarm_description   = "RDS FreeableMemory below 128 MB. db.t3.micro has 1 GB total."
  namespace           = "AWS/RDS"
  metric_name         = "FreeableMemory"
  dimensions          = { DBInstanceIdentifier = aws_db_instance.this.identifier }
  statistic           = "Average"
  period              = 60
  evaluation_periods  = 3
  threshold           = 134217728
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "notBreaching"

  tags = {
    Component = "rds-monitoring"
    ADR       = "ADR-0017"
  }
}
