import { ROTULO_STATUS, CLASSE_STATUS, tempoDoCard } from '../kanbanCampos.js'

/**
 * Modal de detalhes de uma ordem — usado tanto no Acompanhamento (cards com status de
 * producao completo) quanto no Planejamento (cards da fila, que tem o mesmo formato, e
 * cards ja agendados, que so tem um retrato salvo — ai `status` vem ausente e as linhas
 * de producao somem sozinhas, ver os `&&` abaixo). `extra` deixa a tela que chama
 * acrescentar linhas proprias (ex.: "Data planejada" no Planejamento).
 */
export default function ModalDetalheCard({ card, agora, extra, onFechar }) {
  if (!card) return null
  const temStatusProducao = card.status in ROTULO_STATUS

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-label={`Detalhes de ${card.nomeOrdem}`}
      onClick={onFechar}
    >
      <div className="modal__caixa modal__caixa--detalhes" onClick={(e) => e.stopPropagation()}>
        <div className="detalhes__topo">
          <h2 className="modal__titulo">{card.nomeOrdem}</h2>
          {card.pedido && <span className="ficha__pedido">{card.pedido}</span>}
        </div>

        <dl className="detalhes">
          {temStatusProducao && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Status</dt>
              <dd className={`etiqueta ${CLASSE_STATUS[card.status]}`}>{ROTULO_STATUS[card.status]}</dd>
            </div>
          )}
          {card.coluna && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Centro de trabalho</dt>
              <dd>{card.coluna}</dd>
            </div>
          )}
          {(card.operacao != null || card.descricao) && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Etapa atual</dt>
              <dd>
                {card.operacao} — {card.descricao || 'Sem descrição'}
              </dd>
            </div>
          )}
          {card.totalEtapas != null && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Progresso do roteiro</dt>
              <dd>
                {card.etapasConcluidas}/{card.totalEtapas} etapas concluídas
              </dd>
            </div>
          )}
          {card.produto && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Produto</dt>
              <dd>{card.produto}</dd>
            </div>
          )}
          {card.quantidade != null && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Quantidade</dt>
              <dd>
                {card.quantidade} {card.unidadeMedida}
              </dd>
            </div>
          )}
          {card.operadorAtual && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Operador</dt>
              <dd>{card.operadorAtual}</dd>
            </div>
          )}
          {card.motivoParada && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Motivo da parada</dt>
              <dd className="ficha__parada">⏸ {card.motivoParada}</dd>
            </div>
          )}
          {temStatusProducao && (
            <div className="detalhes__linha">
              <dt className="detalhes__rotulo">Tempo</dt>
              <dd>{tempoDoCard(card, agora)}</dd>
            </div>
          )}
          {extra}
          <div className="detalhes__linha">
            <dt className="detalhes__rotulo">Id interno (ordem / operação)</dt>
            <dd className="detalhes__mono">
              {card.idOrdem} / {card.idOperacaoOrdem}
            </dd>
          </div>
        </dl>

        <div className="modal__acoes">
          <button className="botao botao--neutro" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
