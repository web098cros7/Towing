while (True) {
     = aws ssm describe-instance-information --filters "Key=InstanceIds,Values=i-005d38ee6e74a4bcd" | ConvertFrom-Json
    if (.InstanceInformationList.Count -gt 0 -and .InstanceInformationList[0].PingStatus -eq "Online") {
        Write-Host "Online!"
        break
    }
    Start-Sleep -Seconds 15
}
aws ssm send-command --instance-ids "i-005d38ee6e74a4bcd" --document-name "AWS-RunShellScript" --parameters file://ssm3.json --output text --query "Command.CommandId"
