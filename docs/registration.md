# Registrations

## Email domains

A registration takes its inbox domain from `FORCE_EMAIL_DOMAIN` when set.
Otherwise it takes the least-used active domain among the recorded inbound
domains (the Weles setting `inbound_email_domains`) whose MX resolves and that
the platform has not blocked. With none recorded, it takes one of the domains
listed in `AGENT_EMAIL_DOMAINS`, or `AGENT_DOMAIN`. With none of these, the
registration is refused naming them; no domain is assumed.

A recorded domain whose MX lookup fails is marked `mx_broken`, with the
resolver's cause logged, until a later pick finds its MX again. A stored
`inbound_email_domains` value that is not a list is refused with what it holds.
