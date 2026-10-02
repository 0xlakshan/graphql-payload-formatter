<p align="center">
 <h1 align="center"><b>Graphql Payload Formatter</b></h1>
<p align="center">
  Pretty prints GraphQL from inline input, files, or stdin. It converts escaped, single line GraphQL from tools like Chrome DevTools, Caido, or Burp Suite into clean, readable output, supporting queries, mutations, fragments, variables, directives, comments, and SDL.
</p>
</p>


### Usage
```bash
node format-graphql.js "query {\n user(id: \$id) {\n id\n name\n }\n}\n"
node format-graphql.js query.graphql
cat query.graphql | node format-graphql.js
```
Output -
```
query {
  user(id: $id) {
    id
    name
  }
}
```
