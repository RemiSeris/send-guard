# Send Guard — no email leaves Claude without a check and your yes

*[Version française plus bas](#français)*

When Claude can send email for you, one wrong figure, a leftover working note or the wrong recipient goes out in a second. **Send Guard** puts a gate in the code, not in the prompt: every Gmail send (send, reply, forward) is refused until

1. its **exact version** (recipients, subject, body, attachments) has been read by a **context-free verifier**: a separate agent with no memory of your conversation, no tools, that cannot write or send. It checks the facts against the sources Claude gives it, reads the email as the recipient will, and looks for leftover notes. Its verdict is a hint, not a veto: what blocks is a missing check, not a harsh verdict.
2. **you said yes** in Claude's question window. Claude cannot answer it for you. With nobody there to answer (scheduled task, `-p`), the answer is no.

Any edit after the check changes the email's fingerprint and asks for a new check. Sending a draft by its id is refused, since its text cannot be seen.

## Who it's for

Anyone who lets Claude Code draft or send email through a Gmail connector and wants a hard stop before anything leaves.

## Install

**Claude Code**:

```
/plugin marketplace add RemiSeris/send-guard
/plugin install dent-send-guard@dent-send-guard
```

It adds one tool, `verify_send`, that Claude calls before sending. Every decision of the gate is written to the plugin's local log.

## Limits

- It only protects **Claude Code where it is installed**. claude.ai, the Claude app's chat, Cowork, scheduled cloud agents and other machines don't load it.
- It covers Gmail-style connectors (tools named `send_message`, `reply`, `forward`), whatever the server is called. Mail sent another way (browser, another app) is not seen.
- The verifier is only as good as the sources Claude gives it.
- Every send asks for your yes, including emails to yourself.

## What each hook decides

- **Send calls** (`send_message`, `reply`, `forward` on any server): refused unless the exact version was verified and you said yes; otherwise passed on unchanged.
- **`verify_send`**: the plugin's own tool, answered by the plugin itself. It hands the verifier the email exactly as it will be sent (recipients, subject, bodies, readable attachments), what Claude says about the recipient, and the sources Claude gives. Nothing else from your conversation. The verifier has no tools, so it cannot carry that text anywhere.
- **Permission check on `Agent`**: only when Claude Code refuses the launch of send-guard's own verifier (auto mode can do this, since no request of yours started it), you are asked instead. It never allows anything by itself and leaves every other decision as it is.
- **Subagent start**: text other plugins add to every subagent is removed for the verifier only, so it stays context-free. The verifier is also hidden from Claude's list of agents.

## What it does with your data

It reads only the arguments of send calls, to block them or let them through. The verifier runs inside your own Claude Code session with no tools. Nothing is sent anywhere else; the fingerprints and the log stay on your machine.

## License

MIT. Made by [Rémi Séris](https://github.com/RemiSeris) — Make a Dent.

---

## Français

# Send Guard — aucun mail ne part de Claude sans vérification et sans ton oui

Quand Claude peut envoyer des mails pour toi, un chiffre faux, une note de travail oubliée ou le mauvais destinataire partent en une seconde. **Send Guard** met une porte dans le code, pas dans le prompt : tout envoi Gmail (envoi, réponse, transfert) est refusé tant que

1. sa **version exacte** (destinataires, objet, corps, pièces jointes) n'a pas été lue par un **vérificateur sans contexte** : un agent à part, sans mémoire de ta conversation, sans outil, qui ne peut ni écrire ni envoyer. Il vérifie les faits contre les sources que Claude lui donne, lit le mail comme le destinataire, et cherche les notes oubliées. Son verdict est un indice, pas un veto : c'est l'absence de vérification qui bloque, pas un verdict sévère.
2. **tu n'as pas dit oui** dans la fenêtre de question de Claude. Claude ne peut pas répondre à ta place. S'il n'y a personne pour répondre (tâche planifiée, `-p`), c'est non.

Toute retouche après la vérification change l'empreinte du mail et demande une nouvelle vérification. L'envoi d'un brouillon par son identifiant est refusé, puisque son texte n'est pas visible.

### Pour qui

Toute personne qui laisse Claude Code rédiger ou envoyer des mails par un connecteur Gmail et veut un vrai arrêt avant que quoi que ce soit parte.

### Installation

**Claude Code** :

```
/plugin marketplace add RemiSeris/send-guard
/plugin install dent-send-guard@dent-send-guard
```

Il ajoute un outil, `verify_send`, que Claude appelle avant d'envoyer. Chaque décision de la porte est inscrite dans le journal local du plugin.

### Limites

- Il ne protège que **Claude Code là où il est installé**. claude.ai, le chat de l'appli Claude, Cowork, les agents planifiés dans le cloud et les autres machines ne le chargent pas.
- Il couvre les connecteurs de type Gmail (outils nommés `send_message`, `reply`, `forward`), quel que soit le nom du serveur. Un mail envoyé autrement (navigateur, autre appli) n'est pas vu.
- Le vérificateur ne vaut que par les sources que Claude lui donne.
- Chaque envoi demande ton oui, y compris un mail à toi-même.

### Ce que décide chaque hook

- **Appels d'envoi** (`send_message`, `reply`, `forward`, quel que soit le serveur) : refusés sauf si la version exacte a été vérifiée et que tu as dit oui ; sinon transmis sans changement.
- **`verify_send`** : l'outil du plugin, auquel le plugin répond lui-même. Il donne au vérificateur le mail exactement tel qu'il partira (destinataires, objet, corps, pièces jointes lisibles), ce que Claude dit du destinataire et les sources que Claude fournit. Rien d'autre de ta conversation. Le vérificateur n'a aucun outil : il ne peut emporter ce texte nulle part.
- **Vérification de permission sur `Agent`** : seulement quand Claude Code refuse le lancement du vérificateur de send-guard (le mode auto peut le faire, puisqu'aucune demande de ta part ne l'a lancé), la question t'est posée à la place. Il n'autorise jamais rien de lui-même et laisse toute autre décision telle quelle.
- **Démarrage d'un sous-agent** : le texte que d'autres plugins ajoutent à chaque sous-agent est retiré pour le vérificateur seul, pour qu'il reste sans contexte. Le vérificateur est aussi masqué de la liste des agents de Claude.

### Ce qu'il fait de tes données

Il ne lit que les arguments des appels d'envoi, pour les bloquer ou les laisser passer. Le vérificateur tourne dans ta propre session Claude Code, sans outil. Rien n'est envoyé ailleurs ; les empreintes et le journal restent sur ta machine.

### Licence

MIT. Fait par [Rémi Séris](https://github.com/RemiSeris) — Make a Dent.
