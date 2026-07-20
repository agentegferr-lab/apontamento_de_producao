import { formatarNumeroBr, formatarMoedaBr, formatarMoedaNumero } from '../numero.js'
import { agruparMaterial, formatarDataBr, somarValorUnico } from '../planejamentoCampos.js'

const DIAS_SEMANA_EXTENSO = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado',
]

/** Modal do dia inteiro do Planejamento — abre ao clicar numa celula do calendario. */
export default function ModalDetalheDia({ data, itens, onFechar, onAbrirItem, onRemoverItem }) {
  if (!data) return null
  const [ano, mes, dia] = data.split('-').map(Number)
  const diaSemana = DIAS_SEMANA_EXTENSO[new Date(ano, mes - 1, dia).getDay()]
  const materiais = agruparMaterial(itens)
  const valorTotalDia = somarValorUnico(itens)

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={`Planejamento de ${formatarDataBr(data)}`} onClick={onFechar}>
      <div className="modal__caixa modal__caixa--dia" onClick={(e) => e.stopPropagation()}>
        <div className="detalhes__topo">
          <h2 className="modal__titulo">{formatarDataBr(data)}</h2>
          <span className="ficha__pedido">{diaSemana}</span>
        </div>

        <section className="detalhes-dia__secao">
          <h3 className="detalhes-dia__subtitulo">
            Ordens planejadas <span className="coluna__contador">{itens.length}</span>
          </h3>
          {itens.length === 0 && <p className="coluna__vazia">Nada planejado para este dia.</p>}
          {itens.length > 0 && (
            <ul className="detalhes-dia__lista">
              {itens.map((item) => (
                <li
                  key={item.id}
                  className={[
                    'detalhes-dia__item',
                    item.iniciado == null ? '' : item.iniciado ? 'planejamento-card--iniciado' : 'planejamento-card--nao-iniciado',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onClick={() => onAbrirItem(item)}
                >
                  <div className="detalhes-dia__item-texto">
                    <span className="planejamento-card__os">{item.nomeOrdem}</span>
                    {item.pedido && <span className="ficha__pedido">{item.pedido}</span>}
                    {item.produto && <p className="planejamento-card__produto">{item.produto}</p>}
                    {item.valorTotal != null && (
                      <p className="planejamento-card__valor">{formatarMoedaBr(item.valorTotal)}</p>
                    )}
                  </div>
                  <button
                    className="planejamento-card__remover"
                    onClick={(e) => {
                      e.stopPropagation()
                      onRemoverItem(item, e)
                    }}
                    aria-label={`Remover ${item.nomeOrdem} do planejamento`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {valorTotalDia > 0 && (
          <section className="detalhes-dia__secao">
            <h3 className="detalhes-dia__subtitulo">Valor total do dia</h3>
            <p className="detalhes-dia__valor-total">{formatarMoedaNumero(valorTotalDia)}</p>
          </section>
        )}

        {materiais.length > 0 && (
          <section className="detalhes-dia__secao">
            <h3 className="detalhes-dia__subtitulo">Material total do dia</h3>
            <ul className="detalhes-dia__lista detalhes-dia__lista--material">
              {materiais.map((m) => (
                <li key={m.chave} className="planejamento__material-linha">
                  <span className="planejamento__material-qtd">{formatarNumeroBr(m.quantidade)}</span>
                  <span className="planejamento__material-nome">
                    {m.unidadeMedida} · {m.produto}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="modal__acoes">
          <button className="botao botao--neutro" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}
