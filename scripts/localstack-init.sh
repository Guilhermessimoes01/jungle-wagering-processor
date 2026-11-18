#!/bin/sh
set -eu
awslocal sqs create-queue --queue-name wager-transactions-dlq.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false >/dev/null || true
DLQ_ARN="arn:aws:sqs:us-east-1:000000000000:wager-transactions-dlq.fifo"
ATTR=$(printf '{"FifoQueue":"true","ContentBasedDeduplication":"false","VisibilityTimeout":"45","RedrivePolicy":"{\\"deadLetterTargetArn\\":\\"%s\\",\\"maxReceiveCount\\":\\"5\\"}"}' "$DLQ_ARN")
awslocal sqs create-queue --queue-name wager-transactions.fifo --attributes "$ATTR" >/dev/null || true

awslocal sqs create-queue --queue-name wager-events.fifo --attributes FifoQueue=true,ContentBasedDeduplication=false,VisibilityTimeout=45 >/dev/null || true
