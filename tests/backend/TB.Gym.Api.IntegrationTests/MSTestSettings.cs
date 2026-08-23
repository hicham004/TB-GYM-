// Every method provisions and migrates an isolated PostgreSQL database. Unbounded processor-count
// parallelism overwhelms a normal development database and turns cleanup into stream timeouts.
[assembly: Parallelize(Workers = 4, Scope = ExecutionScope.MethodLevel)]
