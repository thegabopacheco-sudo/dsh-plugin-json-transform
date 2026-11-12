# dsh-plugin-json-transform — JSON Transform

Transforma JSON local sin eval: pick/omit/rename, flatten, ordenar, limitar, filtrar por campo y get por ruta, con salida y guardado confirmado.

## Tools

| Tool | Qué hace |
|---|---|
| `status` | Estado |
| `transform` | Transformar JSON |

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-json-transform` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-json-transform
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_JSON_TRANSFORM_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\json-transform\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
