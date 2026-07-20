import { formatarNumeroBr, formatarMoedaBr, formatarMoedaNumero } from '../numero.js'
import { agruparMaterial, formatarDataBr, somarValorUnico } from '../planejamentoCampos.js'

/**
 * So aparece na hora de imprimir (ver `.relatorio-impressao` em styles.css, escondido em
 * tela e mostrado via @media print) — o botao "Imprimir relatorio" chama window.print(),
 * e quem imprime escolhe "Salvar como PDF" no proprio dialogo do navegador. `itens` ja
 * vem filtrado pelo periodo escolhido em TelaPlanejamento.jsx.
 *
 * O valor total do periodo (no fim) deduplica por pedido em TODO o periodo de uma vez —
 * se o mesmo pedido tiver ordens em dias diferentes dentro do periodo, o subtotal de CADA
 * dia conta o valor dele (pra o subtotal do dia fazer sentido sozinho), mas o total geral
 * so conta uma vez. Por isso a soma dos subtotais de cada dia pode passar do total geral
 * quando isso acontece — e o preco de usar o valor do PEDIDO INTEIRO, nao rateado por OS.
 */
export default function RelatorioImpressao({ itens, periodoLabel }) {
  const porDia = new Map()
  for (const item of itens) {
    if (!porDia.has(item.data)) porDia.set(item.data, [])
    porDia.get(item.data).push(item)
  }
  const dias = [...porDia.keys()].sort()
  const materiais = agruparMaterial(itens)
  const valorTotalPeriodo = somarValorUnico(itens)

  return (
    <div className="relatorio-impressao">
      <h1 className="relatorio-impressao__titulo">Relatório de planejamento de produção</h1>
      <p className="relatorio-impressao__periodo">{periodoLabel}</p>

      <section className="relatorio-impressao__secao">
        <h2>Ordens planejadas ({itens.length})</h2>
        {itens.length === 0 && <p>Nenhuma ordem planejada no período selecionado.</p>}
        {dias.map((data) => (
          <div className="relatorio-impressao__dia" key={data}>
            <h3>{formatarDataBr(data)}</h3>
            <table>
              <thead>
                <tr>
                  <th>OS</th>
                  <th>Pedido</th>
                  <th>Produto</th>
                  <th>Quantidade</th>
                  <th>Valor</th>
                </tr>
              </thead>
              <tbody>
                {porDia.get(data).map((item) => (
                  <tr key={item.id}>
                    <td>{item.nomeOrdem}</td>
                    <td>{item.pedido || '-'}</td>
                    <td>{item.produto || '-'}</td>
                    <td>{item.quantidade != null ? `${item.quantidade} ${item.unidadeMedida || ''}` : '-'}</td>
                    <td>{item.valorTotal != null ? formatarMoedaBr(item.valorTotal) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="relatorio-impressao__subtotal">
              Subtotal do dia: {formatarMoedaNumero(somarValorUnico(porDia.get(data)))}
            </p>
          </div>
        ))}
      </section>

      {valorTotalPeriodo > 0 && (
        <section className="relatorio-impressao__secao">
          <h2>Valor total do período</h2>
          <p className="relatorio-impressao__total">{formatarMoedaNumero(valorTotalPeriodo)}</p>
        </section>
      )}

      {materiais.length > 0 && (
        <section className="relatorio-impressao__secao">
          <h2>Material total do período</h2>
          <table>
            <thead>
              <tr>
                <th>Quantidade</th>
                <th>Unidade</th>
                <th>Material</th>
              </tr>
            </thead>
            <tbody>
              {materiais.map((m) => (
                <tr key={m.chave}>
                  <td>{formatarNumeroBr(m.quantidade)}</td>
                  <td>{m.unidadeMedida}</td>
                  <td>{m.produto}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
