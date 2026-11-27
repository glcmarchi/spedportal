Specifiche Motore di Calcolo Tariffe, Margini e Contabilità Piattaforma
1. Architettura Finanziaria e Filosofia del Modello
SpedPortal implementa un modello economico multi-livello a cascata progettato per abilitare una catena commerciale a tre nodi: Super Admin (proprietario della piattaforma), Reseller (agenzia logistica o broker) e Sub-Cliente (mittente finale del servizio).
La finalità primaria del motore finanziario consiste nel garantire una rigorosa separazione tra il flusso di acquisto all'ingrosso dei servizi di spedizione dai corrieri e la rivendita granulare ai clienti finali, assicurando margini certi per tutti gli attori ed eliminando il rischio di esposizione finanziaria non coperta.
Il flusso economico si articola su tre stadi progressivi:

Costo Vivo Corriere: il nolo base sommato ai supplementi contrattuali (carburante, aree remote, opzioni accessorie) restituito dalle API dei vettori o simulato dai connettori interni.
Costo di Acquisto Reseller: il corrispettivo che il Reseller deve versare alla piattaforma per l'emissione della lettera di vettura, differenziato a seconda che utilizzi contratti Master dell'Admin o codici propri.
Prezzo Finale Sub-Cliente: la tariffa visibile e addebitata al cliente finale, generata tramite l'applicazione del profilo margini del Reseller sopra la componente di trasporto.

Il sistema osserva tre principi architetturali vincolanti:

Asimmetria di Visibilità: il cliente finale con ruolo user non ha mai accesso, né a livello visivo né tramite ispezione dei payload JSON di rete, ai costi vivi dei corrieri o ai margini applicati a monte; la risposta API del preventivo espone unicamente il prezzo finale a lui riservato.
Immutabilità dei Costi Storici: nel momento esatto in cui viene emessa la lettera di vettura, tutti i parametri di costo, margine percentuale e commissione calcolati in quel dato istante vengono congelati nel documento della spedizione su database MongoDB, proteggendo la contabilità pregressa da successive variazioni dei listini.
Neutralità delle Commissioni (Opzione B): la commissione software della piattaforma non viene moltiplicata a cascata dalle percentuali di ricarico del Reseller, evitando distorsioni tariffarie ed eccessivi incrementi di prezzo sul cliente finale.


2. Governance Contratti Corriere e Routing Multi-Tenant
La piattaforma supporta un'assegnazione granulare delle policy di spedizione, configurabile dal Super Admin per ogni singola coppia (Reseller, Corriere) tra i vettori integrati (brt, gls, dhl, ups, tnt, poste).
Tipologie di Policy Contrattuale
Policy AssegnataTitolare Codice (contract_owner)Configurazione ResellerFlusso Finanziario verso la PiattaformaCodice Admin (admin_only)adminNessuna credenziale richiesta; il Reseller spedisce sui contratti Master della piattaforma.Il Reseller corrisponde il costo di trasporto maggiorato del margine Admin + la Commissione Piattaforma per codici Admin (fee_on_admin_codes).Codice Reseller (reseller_only)resellerObbligatoria la registrazione e autenticazione dei codici cliente propri dell'agenzia.Il trasporto viene liquidato direttamente tra Reseller e Corriere; alla piattaforma è dovuta esclusivamente la Commissione Piattaforma per codici propri (per_shipment_fee).Disabilitato (disabled)N/DCorriere escluso.Il corriere non compare nel preventivatore e non può essere utilizzato.
Risoluzione Dinamica del Contratto
Durante l'elaborazione del preventivo (/api/shipments/quote) e la successiva conferma (/api/shipments), il backend risolve dinamicamente il contratto:

Se la policy è impostata su admin_only, il sistema interroga l'API del corriere utilizzando le credenziali master salvate nella collezione system_settings (documento master_carriers).
Se la policy è impostata su reseller_only, il sistema verifica la presenza di credenziali validate nello store carrier_credentials del documento reseller. Se non validate, il corriere viene inibito dall'emissione etichette.


3. Motore dei Ricarichi Percentuali: Regole Flat vs Macro-Aree
Sia il Super Admin (nella configurazione dei margini Master e dei margini specifici per Reseller) sia il Reseller (nella creazione dei profili ricarico clienti in AdminRates) operano tramite una struttura dati normalizzata denominata MarkupRule, gestita dalla funzione normalize_markup_rule in backend/tenancy.py.
Definizione Struttura Regola
La regola può operare in due modalità mutuamente esclusive:
{
    "mode": "flat",       # oppure "area"
    "flat": 5.0,          # Margine unico applicato a qualsiasi tratta (%)
    "domestic": 5.0,      # Tratte nazionali (Italia su Italia) (%)
    "europe": 5.0,        # Destinazioni Unione Europea (%)
    "world": 5.0          # Destinazioni Extra-UE / Resto del Mondo (%)
}

Risoluzione Geografica della Destinazione
Il backend determina l'area geografica di destinazione tramite l'analisi dei codici ISO a due lettere del mittente e del destinatario:

Italia / Domestico (domestic): mittente e destinatario risiedono entrambi in Italia (country == 'IT').
Europa UE (europe): la destinazione appartiene all'elenco dei 27 Paesi membri dell'Unione Europea (AT, BE, BG, CY, CZ, DE, DK, EE, ES, FI, FR, GR, HR, HU, IE, IT, LT, LU, LV, MT, NL, PL, PT, RO, SE, SI, SK).
Mondo Extra-UE (world): qualsiasi destinazione al di fuori dell'Unione Europea (compresi Regno Unito, Svizzera, Norvegia, USA, Canada, Asia, Africa e Sud America).

Se la regola è in modalità flat, il valore del margine corrisponde sempre a rule.flat, indipendentemente dalla destinazione. Se la regola è in modalità area, il motore seleziona dinamicamente il valore specifico dell'area geografica individuata.

4. Commissioni Piattaforma e Meccanismo "Opzione B"
Per coprire i costi operativi e monetizzare l'utilizzo dell'infrastruttura software, il Super Admin definisce sul profilo di ciascun Reseller due distinte commissioni per lettera di vettura:

fee_on_admin_codes: Commissione Piattaforma applicata quando la spedizione viaggia su contratti Master dell'Admin (es. € 0,25).
per_shipment_fee: Commissione Piattaforma applicata quando la spedizione viaggia su contratti propri del Reseller (es. € 0,15).

L'Architettura dell'Opzione B
Nel calcolo del prezzo al cliente finale, la piattaforma adotta la formula denominata Opzione B, implementata per evitare l'effetto a cascata del ricarico su ricarico.
Con l'Opzione B:

La percentuale di margine del Reseller si applica esclusivamente alla componente di trasporto (comprensiva di nolo e supplementi del corriere).
La Commissione Piattaforma viene sommata in forma fissa e netta al termine del calcolo, senza subire la percentuale di ricarico del Reseller.

Questo schema assicura che una commissione software di € 0,25 rimanga invariata nel passaggio dal Reseller al cliente finale, evitando che un ricarico commerciale del +20% o +50% incrementi la fee fissa della piattaforma.

5. Formulazione Matematica e Scenari Numerici
Modello Matematico
Siano definiti i seguenti parametri:

$C_{api}$: Costo vivo restituito dal corriere (Nolo base + Supplementi vettoriali).
$M_{adm}$: Margine percentuale del Super Admin (estratto dalla regola flat o per macro-area applicabile al corriere e al Reseller).
$F_{plat}$: Commissione Piattaforma (fee_on_admin_codes se contratto Admin, per_shipment_fee se proprio).
$M_{res}$: Margine percentuale del Reseller (impostato nel profilo margini abbinato al sub-cliente).

1. Caso Spedizione su Codice Master Admin
La componente di trasporto calcolata al Reseller è data da:
$$T_{res} = C_{api} \times \left(1 + \frac{M_{adm}}{100}\right)$$
L'addebito totale della piattaforma verso il Reseller ammonta a:
$$D_{res} = T_{res} + F_{plat}$$
Il prezzo finale addebitato al Sub-Cliente risulta:
$$P_{cli} = \left[ T_{res} \times \left(1 + \frac{M_{res}}{100}\right) \right] + F_{plat}$$
Il margine netto conseguito dal Reseller sul proprio cliente è esattamente pari a:
$$\Pi_{res} = P_{cli} - D_{res} = T_{res} \times \frac{M_{res}}{100}$$
2. Caso Spedizione su Codice Proprio del Reseller
Il trasporto viene regolato direttamente tra corriere e Reseller, pertanto verso la piattaforma il trasporto dovuto è pari a zero:
$$T_{res}^{plat} = 0.00$$
L'addebito della piattaforma verso il Reseller corrisponde unicamente alla fee software:
$$D_{res} = F_{plat}$$
Il prezzo finale formulato dal Reseller per il suo Sub-Cliente applica il ricarico sul costo API reale del contratto del Reseller:
$$P_{cli} = \left[ C_{api} \times \left(1 + \frac{M_{res}}{100}\right) \right] + F_{plat}$$
Il guadagno commerciale del Reseller ammonta a:
$$\Pi_{res} = P_{cli} - C_{api} - F_{plat} = C_{api} \times \frac{M_{res}}{100}$$

Scenari Numerici Comparativi
Ipotizzando una spedizione con costo corriere $C_{api} = € 10,00$, margine Admin $M_{adm} = 10\%$, margine Reseller $M_{res} = 20\%$, $F_{plat}^{admin} = € 0,25$ e $F_{plat}^{reseller} = € 0,15$:
Voce EconomicaSpedizione su Codice Master AdminSpedizione su Codice Proprio ResellerSpedizione Diretta Reseller (Codice Admin)Costo API Corriere ($C_{api}$)€ 10,00€ 10,00 (gestito fuori piattaforma)€ 10,00Trasporto con Margine Admin ($T_{res}$)€ 11,00N/D (€ 0,00 verso piattaforma)€ 11,00Commissione Piattaforma ($F_{plat}$)€ 0,25€ 0,15€ 0,25Costo Totale Reseller ($D_{res}$)€ 11,25€ 0,15€ 11,25Prezzo Sub-Cliente ($P_{cli}$)€ 13,45 (€ 11,00 × 1,20 + € 0,25)€ 12,15 (€ 10,00 × 1,20 + € 0,15)N/D (Spedizione interna)Utile Piattaforma (Admin)€ 1,25 (€ 1,00 marg. + € 0,25 fee)€ 0,15 (solo fee)€ 1,25Utile Netto Reseller€ 2,20€ 2,00N/D

6. Modelli di Pagamento e Flussi Contabili
SpedPortal supporta tre modalità di pagamento configurabili sia sull'asse Admin-Reseller, sia sull'asse Reseller-Cliente.
1. Prepagato con Wallet e Registro Ledger (prepaid)

Meccanismo: l'utente o il Reseller dispone di un credito nominale nel campo credit_balance.
Verifica Atomica: all'atto della creazione della spedizione, il sistema controlla che credit_balance >= importo_dovuto. In caso positivo, il credito viene decrementato in modo atomico e viene generata una transazione nel registro mastro (ledger per gli utenti, reseller_ledger per i Reseller).
Tipologie di Movimento:

admin_topup: accredito fondi registrato dal Super Admin a seguito di bonifico bancario.
stripe_topup: ricarica automatica con carta di credito gestita tramite checkout Stripe.
shipment_charge: addebito per emissione spedizione su contratti Admin.
label_fee: addebito della sola commissione software su contratti propri.
shipment_refund: riaccredito automatico a seguito di annullamento della spedizione.



2. Fatturazione Differita Fine Mese (postpaid)

Meccanismo: il soggetto è affidato e può creare spedizioni con saldo a zero.
Flusso: le spedizioni vengono emesse con stato contabile aperto; a fine mese l'amministratore (Admin per i Reseller, Reseller per i Sub-Clienti) interroga la funzione di estratto conto consolidato, filtra l'intervallo temporale ed esporta il riepilogo per l'emissione della fattura fiscale.

3. Pagamento Istantaneo (instant / Pay-per-Shipment)

Meccanismo: pensato per clienti occasionali o senza fido commerciale.
Flusso Operativo:

La spedizione viene inserita nello stato awaiting_payment. Nessuna chiamata di prenotazione o etichettatura viene inoltrata al corriere.
Viene aperta la sessione di checkout Stripe per l'importo $P_{cli}$.
Alla ricezione del webhook con esito positivo (payment_status == 'paid'), il backend perfeziona la spedizione, interroga l'API del corriere, genera il documento PDF di trasporto e produce la ricevuta contabile.




7. Mitigazione del Rischio e Gerarchia Wallet B2B2B
Una delle problematiche critiche nei modelli B2B2B a portafoglio multiplo risiede nel disallineamento dei crediti: la situazione in cui un Sub-Cliente dispone di fondi nel proprio wallet presso il Reseller, ma il Reseller ha azzerato il proprio credito verso la Piattaforma.
Per azzerare l'esposizione creditizia dell'Admin, SpedPortal implementa una regola strutturale di conformità:
Un Reseller può abilitare la modalità prepaid per i propri Sub-Clienti esclusivamente se il Reseller stesso è configurato in modalità Postpagata (Fatturazione Fine Mese) verso la Piattaforma.
Nel caso in cui il Reseller sia impostato su prepaid verso l'Admin, la funzionalità client_prepaid viene inibita a livello di interfaccia e rifiutata dal validatore di schema in backend/tenancy.py.
I Sub-Clienti di un Reseller prepagato operano unicamente tramite Pagamento Istantaneo (carta/Stripe) o Fatturazione Fine Mese concordata con il Reseller, impedendo qualsiasi situazione di credito bloccato a metà catena.

8. Persistenza dei Dati e Schema Immutabile MongoDB
Per rendere inattaccabili le riconciliazioni contabili, la collezione shipments registra in ciascun documento uno snapshot esaustivo delle componenti finanziarie calcolate al timestamp di emissione:
{
  "id": "shp_9a8b7c6d5e",
  "tracking_number": "794839201948",
  "carrier_id": "tnt",
  "carrier_name": "FedEx",
  "contract_owner": "admin",
  "on_master_codes": true,
  "carrier_code_used": "987654321",

  "carrier_cost": 10.00,
  "reseller_transport_cost": 11.00,
  "applied_fee": 0.25,
  "reseller_cost": 11.25,
  "price": 13.45,

  "admin_markup_percent": 10.0,
  "reseller_markup_percent": 20.0,
  "admin_margin_earned": 1.00,
  "reseller_margin_earned": 2.20,

  "user_id": "usr_client001",
  "user_company_name": "E-Commerce Srl",
  "created_by_role": "user",
  "reseller_id": "res_demo123",

  "status": "created",
  "created_at": "2026-11-27T10:15:30Z"
}

La collezione reseller_ledger traccia la cronistoria dei movimenti del credito del Reseller:
{
  "id": "led_3f2a1b9c8d",
  "reseller_id": "res_demo123",
  "type": "shipment_charge",
  "amount": -11.25,
  "balance_after": 488.75,
  "shipment_id": "shp_9a8b7c6d5e",
  "tracking_number": "794839201948",
  "note": "Spedizione 794839201948 (E-Commerce Srl)",
  "created_at": "2026-11-27T10:15:30Z"
}

Qualsiasi modifica successiva a listini, regole flat o percentuali per area non altera i valori memorizzati in questo documento, consentendo riepiloghi contabili affidabili nel tempo.

9. Endpoint di Rendicontazione ed Esportazione Contabile
La piattaforma offre due interfacce di estrazione dati:
1. Rendicontazione Piattaforma verso Reseller (/api/super/resellers/{rid}/billing)
Accessibile esclusivamente dal Super Admin. Accetta i parametri di query date_from e date_to.

Raggruppa i volumi distinguendo tra spedizioni dirette del Reseller e spedizioni emesse da ciascun Sub-Cliente (breakdown_by_origin).
Separa i ricavi da trasporto sui codici Admin (amount_due_standard), il margine di ricarico puro dell'Admin (admin_margin_earned) e il gettito delle commissioni piattaforma (fees_due_total).
Consente il download del foglio di calcolo formattato via streaming binario tramite l'endpoint complementare /api/super/resellers/{rid}/billing/export. Il file generato con openpyxl include due fogli: Riepilogo Contabile (totali per origine e imponibile aggregato) e Dettaglio Spedizioni (data, tracking, origine, corriere, contratto, costo API, trasporto addebitato, commissione piattaforma e addebito totale).

2. Rendicontazione Reseller verso Sub-Clienti (/api/reseller/accounting)
Accessibile dal Reseller Admin.

Permette di filtrare per intervallo di date e per singolo cliente (client_id).
Calcola per ciascun cliente il numero di spedizioni emesse, il volume ancora da fatturare (per utenti postpaid), il costo sostenuto dal Reseller, il fatturato generato e il margine lordo conseguito.
