#!/usr/bin/env bash
# bench/run.sh page|sse — runs the load generators inside the compose network
# and writes raw output to results/. The stack must be up (make up).
set -euo pipefail
cd "$(dirname "$0")/.."
C="docker compose"
what="${1:?page or sse}"

env_report() {
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "commit: $(git rev-parse --short HEAD 2>/dev/null || echo none)"
  if [ "$(uname)" = Darwin ]; then
    echo "host: $(sysctl -n machdep.cpu.brand_string), $(sysctl -n hw.ncpu) cores, $(( $(sysctl -n hw.memsize) / 1073741824 )) GiB"
  else
    echo "host: $(nproc) cores, $(free -g | awk '/Mem:/{print $2}') GiB"
  fi
  docker info --format 'docker VM: {{.NCPU}} vCPU, {{.MemTotal}} bytes, server {{.ServerVersion}}'
  echo "containers running (all projects on this docker host): $(docker ps -q | wc -l | tr -d ' ')"
  echo "containers of this project: $($C ps -q | wc -l | tr -d ' ')"
}

$C build -q tools
case "$what" in
  page)
    # --no-deps: otherwise `run` re-creates app from its default config (cache on)
    for rep in $(seq 1 "${REPS:-3}"); do
      for mode in nocache cache cache-invalidate-1s; do
        off=$([ "$mode" = nocache ] && echo 1 || echo 0)
        extra=$([ "$mode" = cache-invalidate-1s ] && echo "--invalidate-ms 1000" || true)
        CACHE_DISABLED=$off $C up -d --wait app edge >/dev/null 2>&1
        { env_report; echo "app CACHE_DISABLED=$($C exec -T app printenv CACHE_DISABLED)"; echo; \
          $C run --rm --no-deps tools node bench/page.ts "$mode-r$rep" $extra; } 2>&1 | tee "results/page-$mode-r$rep.txt"
      done
    done
    CACHE_DISABLED=0 $C up -d --wait app edge >/dev/null 2>&1
    ;;
  sse)
    # the ladder stops at the first client count over budget; repeated because the VM is shared
    for rep in $(seq 1 "${REPS:-3}"); do
      $C restart app >/dev/null 2>&1 && $C up -d --wait app >/dev/null 2>&1
      # CPU/memory of the moving parts every ~5 s while the ladder runs
      ( while :; do date -u +%T; docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' | grep -E 'pulseboard-(app|edge|redis)-1|tools-run'; sleep 3; done ) \
        > "results/sse-r$rep-docker-stats.txt" 2>&1 &
      sampler=$!
      { env_report; echo; $C run --rm --no-deps tools node bench/sse.ts --out "sse-r$rep" "${@:2}"; } 2>&1 | tee "results/sse-r$rep.txt"
      kill "$sampler"
    done
    ;;
  *) echo "unknown: $what" >&2; exit 2 ;;
esac
