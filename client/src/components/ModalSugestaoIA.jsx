import { useState } from 'react'
import { formatarMoedaBr } from '../numero.js'
import { formatarDataBr, somarValorUnico } from '../planejamentoCampos.js'

/**
 * Mostra o RASCUNHO devolvido por /api/planejamento/sugestao (ver server/ia.js) — a IA
 * nunca agenda nada sozinha, so sugere. O usuario marca quais quer aplicar de verdade;
 * "Aplicar selecionadas" e quem realmente chama api.agendar() pra cada uma (ver
 * TelaPlanejamento.jsx/aplicarSugestoes).
 */
export default function ModalSugestaoIA({ sugestao, aplicando, onAplicar, onFechar }) {
  const [marcadas, setMarcadas] = useState(() => new Set(sugestao.sugestoes.map((s) => s.idOperacaoOrdem)))

  function alternar(idOperacaoOrdem) {
    setMarcadas((atual) => {
      const novo = new Set(atual)
      if (novo.has(idOperacaoOrdem)) novo.delete(idOperacaoOrdem)
      else novo.add(idOperacaoOrdem)
      return novo
    })
  }

  const selecionadas = sugestao.sugestoes.filter((s) => marcadas.has(s.idOperacaoOrdem))
  const valorSelecionado = somarValorUnico(selecionadas)

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Sugestão de planejamento por IA" onClick={onFechar}>
      <div className="modal__caixa modal__caixa--dia" onClick={(e) => e.stopPropagation()}>
        <h2 className="modal__titulo">Sugestão de planejamento</h2>
        {sugestao.resumo && <p className="modal__texto">{sugestao.resumo}</p>}

        <section className="detalhes-dia__secao">
          <h3 className="detalhes-dia__subtitulo">
            Ordens sugeridas <span className="coluna__contador">{sugestao.sugestoes.length}</span>
          </h3>
          {sugestao.sugestoes.length === 0 && (
            <p className="coluna__vazia">A IA não encontrou uma combinação pra sugerir — tente descrever o objetivo de outro jeito.</p>
          )}
          {sugestao.sugestoes.length > 0 && (
            <ul className="detalhes-dia__lista">
              {sugestao.sugestoes.map((s) => (
                <li key={s.idOperacaoOrdem} className="detalhes-dia__item detalhes-dia__item--selecionavel">
                  <label className="detalhes-dia__item-texto">
                    <input
                      type="checkbox"
                      checked={marcadas.has(s.idOperacaoOrdem)}
                      onChange={() => alternar(s.idOperacaoOrdem)}
                    />
                    <span>
                      <span className="planejamento-card__os">{s.nomeOrdem}</span>{' '}
                      <span className="ficha__pedido">{formatarDataBr(s.data)}</span>
                      {s.pedido && <span className="ficha__pedido">{s.pedido}</span>}
                      {s.produto && <p className="planejamento-card__produto">{s.produto}</p>}
                      {s.motivo && <p className="planejamento-card__produto">{s.motivo}</p>}
                      {s.valorTotal != null && <p className="planejamento-card__valor">{formatarMoedaBr(s.valorTotal)}</p>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </section>

        {valorSelecionado > 0 && (
          <section className="detalhes-dia__secao">
            <h3 className="detalhes-dia__subtitulo">Valor total selecionado</h3>
            <p className="detalhes-dia__valor-total">
              {somarValorUnico(selecionadas).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </p>
          </section>
        )}

        <div className="modal__acoes">
          <button className="botao botao--neutro" onClick={onFechar} disabled={aplicando}>
            Descartar
          </button>
          <button
            className="botao botao--iniciar"
            onClick={() => onAplicar(selecionadas)}
            disabled={aplicando || selecionadas.length === 0}
          >
            {aplicando ? 'Aplicando...' : `Aplicar ${selecionadas.length} selecionada(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}
