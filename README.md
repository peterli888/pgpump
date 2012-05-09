pgpump
======

Asynchronous PostgreSQL TCP reverse proxy with failover written in Node.JS

## Description

pgpump operates on 2 levels:
- transport level (worker processes) - it forwards TCP packets to configured 
PostgreSQL backends asynchronously. Asynchronous forwarding makes it pretty fast
even with remote high latency connections. 

- application level (master process) - pgpump constantly queries each PostgreSQL 
backend for role in master/hot standby pair. Based on this info, it notifies
the workers of any role switch that has occurred. 

## Features

- Fast
- Automatic master and standby(s) detection
- Automatic failover/failback (not yet fully tested)
- Takes advantage of multi core CPUs by spawning <numCPU> workers
- Configurable timeouts
- .ini style config file
