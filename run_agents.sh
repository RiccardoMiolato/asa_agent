#!/usr/bin/env bash

set -euo pipefail

run_agent() {
  local token="$1"
  local name="$2"

  (
    export TOKEN="$token"
    export NAME="$name"

    echo "Starting $NAME..."
    npm run start
  ) &
}

run_agent "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjI2NTQ2NCIsIm5hbWUiOiJwbDEiLCJyb2xlIjoidXNlciIsImlhdCI6MTc3NzgxNzQyNH0.kCFLshLM-0vhw8Ky51RAYUoBQ7jivHLZ57CkkAZUNEk" "pl1"
run_agent "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFhZTg4NSIsIm5hbWUiOiJwbDIiLCJyb2xlIjoidXNlciIsImlhdCI6MTc3NzgxNzQyN30.ydOU6d0OVhwNgmqNtAWg94huhg_kk_xLKgg79pEG9g0" "pl2"
run_agent "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjIxYTVlZiIsIm5hbWUiOiJwbDMiLCJyb2xlIjoidXNlciIsImlhdCI6MTc3NzgxNzQyOH0.DFuWxdzY-q0IlSuCORnyHQPVk8Hp-JguoKq4xFGzaN4" "pl3"
run_agent "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImVlNDllNyIsIm5hbWUiOiJwbDQiLCJyb2xlIjoidXNlciIsImlhdCI6MTc3NzgxNzQzMH0.FUyQ9MCg7iReYpPO-KFdWSoUYPXUKT_CljjExI-1UeI" "pl4"
run_agent "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6IjAyZTVhMyIsIm5hbWUiOiJwbDUiLCJyb2xlIjoidXNlciIsImlhdCI6MTc3NzgxNzQzMX0.2z2Y-yMjf5As-Ce4GvEJP8m5SxrfI7JiIsFzHA-L04E" "pl5"

wait