# Synthetic owner interview

Owner: returns-owner

For the same order and request id, retrying an already accepted return must replay the prior accepted result
and must not request another refund.

Support currently allows opened packaging when the item remains sellable. Warehouse operations says every
opened package needs inspection before acceptance. No authoritative decision has reconciled those statements,
so opened-package behavior must not become a hard requirement in this exercise.
